// 前回の調査（カルテ）の読み込み・まとめ・木との結び付け・サーバーへの受け渡し
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { checked, readKarteBook } from '../src/excel/karte.js';
import { blankTree } from '../src/core/tree.js';
import { validateConfig } from '../src/core/config.js';
import { idbReset } from '../src/store/idb.js';
import {
  buildPrevious,
  clearPrevious,
  getPreviousIndex,
  getPreviousPhotos,
  loadAllPrevious,
  loadIndex,
  loadPhotos,
  photosOf,
  prevCount,
  prevKey,
  prevOf,
  putPrevious,
  savePrevious,
} from '../src/store/previous.js';
import { makeKarte, TINY_JPEG } from './helpers/makeKarte.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const order = cfg.previous.kartes.map((k) => k.id);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'pc' };
const read = async (trees) => (await readKarteBook(await makeKarte(trees), cfg, '架空.xlsx')).trees;

beforeEach(async () => {
  await idbReset();
  indexedDB.deleteDatabase('shindans');
});

describe('カルテを読む', () => {
  it('1本1シートから、番号・場所・樹種・日付・「有」の弱点・評価・写真を読む。カルテでないシートは飛ばす', async () => {
    const r = await readKarteBook(await makeKarte(), cfg, '架空.xlsx');
    expect(r.skipped).toEqual(['架空.xlsx 一覧']);
    expect(r.trees.map((t) => t.treeNo)).toEqual(['AB001', 'AB002']);
    const t = r.trees[0];
    expect(t).toMatchObject({ kind: 'detail', title: '前回の詳しい診断', code: 'K01', placeName: '架空公園', species: 'テストノキ', date: '2090-09-01' });
    expect(t.inspector).toBe('試験 一郎(資格)・試験 二郎(資格)');
    expect(t.items).toEqual([
      { part: '枝', item: '②折れた枝', result: '有', grade: 'C', detail: '1本、地上約5m' },
      { part: '幹', item: '①うろ', result: '有（大）', grade: 'E', detail: '地上0～1m、30×20cm' },
      { part: '根', item: '①根の傷み', result: '有（小）', grade: 'D', detail: '根元' },
    ]);
    expect(t.summary).toEqual([
      { label: '見た目の評価', lines: ['生育 B', '危険度 E うろ・根の傷み'] }, // 「飾り」は除く
      { label: 'まとめ', lines: ['D 幹のうろが大きい。'] },
    ]);
    expect(t.photos.map((p) => [p.caption, p.type])).toEqual([
      ['全体の写真', 'image/jpeg'],
      ['弱点の図', 'image/jpeg'],
    ]);
    expect(Buffer.from(t.photos[0].buffer)).toEqual(TINY_JPEG);
    expect(r.trees[1].photos).toEqual([]);
  });

  it('種類の違うカルテは表題で見分ける。日付の通し番号・チェック欄・左右に並んだ写真・写真の下の名前', async () => {
    const [t] = await read([{ no: 'AB001', kind: 'place' }]);
    expect(t).toMatchObject({ kind: 'place', title: '周りの様子', treeNo: 'AB001', code: 'K01', date: '2021-10-13', species: '' });
    expect(t.items).toEqual([{ part: 'まわり', item: '人の通行', result: '有', grade: '', detail: '歩く人' }]);
    expect(t.summary).toEqual([{ label: '土地の使われ方', lines: ['住宅地'] }]);
    expect(t.photos.map((p) => p.caption)).toEqual(['配置の図', '周りの写真', '根元の様子']);
  });

  it('チェック欄は■の言葉だけ', () => {
    expect(checked('□Ａ　■Ｂ　□Ｃ')).toBe('Ｂ');
    expect(checked('■必要　□不要')).toBe('必要');
    expect(checked('□無　□有')).toBe('');
    expect(checked('ふつうの文')).toBe('ふつうの文');
  });

  it('設定に読み方がなければ知らせる。読み方の設定が不正なら設定ごと使わない。以前の形（1種類）も使える', async () => {
    const { previous, ...noPrev } = cfg;
    await expect(readKarteBook(await makeKarte(), noPrev)).rejects.toThrow('previous.kartes');
    expect(validateConfig(noPrev).ok).toBe(true); // 省略してよい
    expect(validateConfig(cfg).ok).toBe(true);
    const bad = { ...cfg, previous: { kartes: [{ id: 'a', fields: {}, yesMark: '■有' }] } };
    expect(validateConfig(bad).errors.join()).toMatch('treeNo');
    const dup = { ...cfg, previous: { kartes: [cfg.previous.kartes[0], cfg.previous.kartes[0]] } };
    expect(validateConfig(dup).errors.join()).toMatch('重複');
    const { id, match, ...one } = cfg.previous.kartes[0];
    const legacy = { ...cfg, previous: { karte: one } };
    expect(validateConfig(legacy).ok).toBe(true);
    expect((await readKarteBook(await makeKarte(), legacy)).trees).toHaveLength(2);
  });
});

describe('まとめて、木と結び付ける', () => {
  const park = (o) => blankTree({ siteType: 'park', parkCode: 'K01', ...o });

  it('1本に種類の違うカルテをまとめる。要点は全部を1つに、写真は場所ごとに分ける', async () => {
    const a = await read([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002', species: 'ミホンカエデ', withPhoto: false }]);
    const b = await read([{ no: 'AB001', code: 'K09', species: '別の樹種' }]);
    const p = buildPrevious([...a, ...b], 'now', order);
    expect(Object.keys(p.index.trees)).toEqual(['K01|AB001', 'K01|AB002', 'K09|AB001']);
    expect(p.index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail', 'place']);
    expect(p.index.trees['K01|AB001'][1]).toMatchObject({ photoCount: 3, packId: 'p1' });
    expect(p.index.trees['K01|AB001'][0].photos).toBeUndefined(); // 要点に写真は入れない
    expect(p.index.packs).toEqual({ p1: { code: 'K01', count: 5 }, p2: { code: 'K09', count: 2 } });
    expect(photosOf(p.packs.p1, 'K01|AB001', 'place').map((x) => x.caption)).toEqual(['配置の図', '周りの写真', '根元の様子']);
    expect(p.duplicates).toEqual([]);
    expect(buildPrevious([...a, ...a], 'now', order).duplicates).toHaveLength(3);
  });

  it('何回かに分けて読み込める（同じ木・同じ種類は新しい方に入れ替え、場所の束の番号は変えない）', async () => {
    const first = buildPrevious(await read([{ no: 'AB001' }]), 'now', order);
    const second = buildPrevious(await read([{ no: 'AB001', kind: 'place' }, { no: 'AB009', code: 'K09' }]), 'later', order, first);
    expect(second.index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail', 'place']);
    expect(Object.keys(second.packs.p1['K01|AB001'])).toEqual(['detail', 'place']);
    expect(second.index.packs).toEqual({ p1: { code: 'K01', count: 5 }, p2: { code: 'K09', count: 2 } });
    expect(second.duplicates).toEqual([]); // 前の回の分を入れ替えるのは、重複ではない
    expect(first.index.trees['K01|AB001']).toHaveLength(1); // 土台は書き換えない
  });

  it('場所のコード＋番号で結び付ける（全角でも）。番号が同じでも場所が違えば別の木。樹種が違えば知らせる', async () => {
    const { index } = buildPrevious(await read(), 'now', order);
    expect(prevOf(park({ treeNo: 'ＡＢ００１', species: 'テストノキ' }), index, cfg)).toMatchObject({ speciesMismatch: false });
    expect(prevOf(park({ treeNo: 'AB001' }), index, cfg).kartes[0].treeNo).toBe('AB001');
    expect(prevOf(park({ treeNo: 'AB001', parkCode: 'K09' }), index, cfg)).toBeNull();
    expect(prevOf(park({ treeNo: 'AB003' }), index, cfg)).toBeNull();
    expect(prevOf(park({ treeNo: 'AB001', species: 'ちがう木' }), index, cfg).speciesMismatch).toBe(true);
    expect(prevOf(park({ treeNo: 'AB001', species: '' }), index, cfg).speciesMismatch).toBe(false); // 樹種未入力は比べない
    expect(prevOf(park({ treeNo: 'AB002', parkCode: '' }), index, cfg)).not.toBeNull(); // 番号だけで1つに決まる
    expect(prevKey(' K01 ', 'ab001')).toBe('K01|AB001');
  });

  it('以前の形（版1）の要点・写真も読める', () => {
    const v1 = { version: 1, karte: { 'K01|AB001': { treeNo: 'AB001', code: 'K01', species: 'テストノキ', items: [], packId: 'p1' } }, packs: {} };
    expect(prevCount(v1)).toBe(1);
    expect(prevOf(park({ treeNo: 'AB001' }), v1, cfg).kartes[0].kind).toBe('karte');
    expect(photosOf({ 'K01|AB001': [{ caption: 'x' }] }, 'K01|AB001', 'karte')).toEqual([{ caption: 'x' }]);
  });
});

describe('端末とサーバー（にせの Google）', () => {
  it('PC で置いた要点と写真を、スマホが受け取れる（写真は場所ごと）', async () => {
    const g = makeFakeGas();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002' }]), 'now', order));
    const steps = [];
    expect(await putPrevious(server, (d, n) => steps.push(`${d}/${n}`), g.fetchFn)).toBe(2);
    expect(steps).toEqual(['1/2', '2/2']);

    // スマホ（端末の中身を消してから受け取る）
    await idbReset();
    indexedDB.deleteDatabase('shindans');
    expect(await loadIndex()).toBeUndefined();
    expect(await getPreviousIndex(server, g.fetchFn)).toBe(2);
    expect(await loadPhotos('p1')).toBeUndefined(); // 写真はまだ
    await getPreviousPhotos(server, 'p1', g.fetchFn);
    const photos = await loadPhotos('p1');
    expect(Buffer.from(photosOf(photos, 'K01|AB001', 'place')[0].data, 'base64')).toEqual(TINY_JPEG);
    await expect(getPreviousPhotos(server, 'p9', g.fetchFn)).rejects.toThrow('写真がありません');
  });

  it('端末の分を全部読み出して足せる。消せる', async () => {
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }]), 'now', order));
    const base = await loadAllPrevious();
    expect(Object.keys(base.packs.p1)).toEqual(['K01|AB001']);
    await savePrevious(buildPrevious(await read([{ no: 'AB002' }]), 'later', order, base));
    expect(prevCount(await loadIndex())).toBe(2);
    await clearPrevious();
    expect(await loadIndex()).toBeUndefined();
    expect(await loadPhotos('p1')).toBeUndefined();
  });

  it('サーバーは決まった種類のファイルしか受け取らない', () => {
    const { lib } = makeFakeGas();
    expect(['config', 'prevIndex', 'prevPhotos:p1', 'prevPhotos:p1234'].every(lib.isFileKind)).toBe(true);
    expect(['other', 'prevPhotos:', 'prevPhotos:../x', 'prevPhotos:p12345', 'prevPhotosp1'].some(lib.isFileKind)).toBe(false);
  });
});
