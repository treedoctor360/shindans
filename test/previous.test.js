// 前回の調査（カルテ）の読み込み・まとめ・木との結び付け・サーバーへの受け渡し
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { readKarteBook } from '../src/excel/karte.js';
import { blankTree } from '../src/core/tree.js';
import { validateConfig } from '../src/core/config.js';
import { idbReset } from '../src/store/idb.js';
import {
  buildPrevious,
  getPreviousIndex,
  getPreviousPhotos,
  karteOf,
  loadIndex,
  loadPhotos,
  prevKey,
  putPrevious,
  savePrevious,
} from '../src/store/previous.js';
import { makeKarte, TINY_JPEG } from './helpers/makeKarte.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'pc' };

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
    expect(t).toMatchObject({ code: 'K01', placeName: '架空公園', species: 'テストノキ', date: '2090-09-01', inspector: '試験 一郎(資格)・試験 二郎(資格)' });
    expect(t.items).toEqual([
      { part: '枝', item: '②折れた枝', result: '有', grade: 'C', detail: '1本、地上約5m' },
      { part: '幹', item: '①うろ', result: '有（大）', grade: 'E', detail: '地上0～1m、30×20cm' },
      { part: '根', item: '①根の傷み', result: '有（小）', grade: 'D', detail: '根元' },
    ]);
    expect(t.summary).toEqual([
      { label: '見た目の評価', lines: ['生育 B', '危険度 E うろ・根の傷み'] },
      { label: 'まとめ', lines: ['D 幹のうろが大きい。'] },
    ]);
    expect(t.photos.map((p) => [p.caption, p.type])).toEqual([
      ['全体の写真', 'image/jpeg'],
      ['弱点の図', 'image/jpeg'],
    ]);
    expect(Buffer.from(t.photos[0].buffer)).toEqual(TINY_JPEG);
    expect(r.trees[1].photos).toEqual([]);
  });

  it('設定に読み方がなければ知らせる。読み方の設定が不正なら設定ごと使わない', async () => {
    const { previous, ...noPrev } = cfg;
    await expect(readKarteBook(await makeKarte(), noPrev)).rejects.toThrow('previous.karte');
    expect(validateConfig(noPrev).ok).toBe(true); // 省略してよい
    expect(validateConfig(cfg).ok).toBe(true);
    expect(validateConfig({ ...cfg, previous: { karte: { fields: {}, yesMark: '■有' } } }).errors.join()).toMatch('treeNo');
  });
});

describe('まとめて、木と結び付ける', () => {
  const park = (o) => blankTree({ siteType: 'park', parkCode: 'K01', ...o });

  it('要点は全部を1つに、写真は場所ごとに分ける', async () => {
    const a = await readKarteBook(await makeKarte(), cfg);
    const b = await readKarteBook(await makeKarte([{ no: 'AB001', code: 'K09', species: '別の樹種' }]), cfg);
    const p = buildPrevious([...a.trees, ...b.trees], 'now');
    expect(Object.keys(p.index.karte)).toEqual(['K01|AB001', 'K01|AB002', 'K09|AB001']);
    expect(p.index.packs).toEqual({ p1: { code: 'K01', count: 2 }, p2: { code: 'K09', count: 2 } });
    expect(p.index.karte['K01|AB001']).toMatchObject({ photoCount: 2, packId: 'p1' });
    expect(p.index.karte['K01|AB001'].photos).toBeUndefined(); // 要点に写真は入れない
    expect(Object.keys(p.packs.p1)).toEqual(['K01|AB001', 'K01|AB002']);
    expect(p.duplicates).toEqual([]);
    expect(buildPrevious([...a.trees, ...a.trees]).duplicates).toEqual(['K01|AB001', 'K01|AB002']);
  });

  it('場所のコード＋番号で結び付ける（全角でも）。番号が同じでも場所が違えば別の木。樹種が違えば知らせる', async () => {
    const a = await readKarteBook(await makeKarte(), cfg);
    const { index } = buildPrevious(a.trees);
    expect(karteOf(park({ treeNo: 'ＡＢ００１', species: 'テストノキ' }), index, cfg)).toMatchObject({ karte: { treeNo: 'AB001' }, speciesMismatch: false });
    expect(karteOf(park({ treeNo: 'AB001', parkCode: 'K09' }), index, cfg)).toBeNull();
    expect(karteOf(park({ treeNo: 'AB003' }), index, cfg)).toBeNull();
    expect(karteOf(park({ treeNo: 'AB001', species: 'ちがう木' }), index, cfg).speciesMismatch).toBe(true);
    expect(karteOf(park({ treeNo: 'AB001', species: '' }), index, cfg).speciesMismatch).toBe(false); // 樹種未入力は比べない
    // 場所のコードがない木は、番号だけで1つに決まるときだけ
    expect(karteOf(park({ treeNo: 'AB002', parkCode: '' }), index, cfg)).not.toBeNull();
    expect(prevKey(' K01 ', 'ab001')).toBe('K01|AB001');
  });
});

describe('サーバーへの受け渡し（にせの Google）', () => {
  it('PC で置いた要点と写真を、スマホが受け取れる（写真は場所ごと）', async () => {
    const g = makeFakeGas();
    const a = await readKarteBook(await makeKarte(), cfg);
    await savePrevious(buildPrevious(a.trees));
    const steps = [];
    expect(await putPrevious(server, (d, n) => steps.push(`${d}/${n}`), g.fetchFn)).toBe(2);
    expect(steps).toEqual(['1/2', '2/2']);

    // スマホ（端末の中身を消してから受け取る）
    await idbReset();
    indexedDB.deleteDatabase('shindans');
    expect(await loadIndex()).toBeUndefined();
    expect(await getPreviousIndex(server, g.fetchFn)).toBe(2);
    expect(Object.keys((await loadIndex()).karte)).toEqual(['K01|AB001', 'K01|AB002']);
    expect(await loadPhotos('p1')).toBeUndefined(); // 写真はまだ
    await getPreviousPhotos(server, 'p1', g.fetchFn);
    const photos = await loadPhotos('p1');
    expect(Buffer.from(photos['K01|AB001'][0].data, 'base64')).toEqual(TINY_JPEG);
    await expect(getPreviousPhotos(server, 'p9', g.fetchFn)).rejects.toThrow('写真がありません');
  });

  it('サーバーは決まった種類のファイルしか受け取らない', () => {
    const { lib } = makeFakeGas();
    expect(['config', 'prevIndex', 'prevPhotos:p1', 'prevPhotos:p1234'].every(lib.isFileKind)).toBe(true);
    expect(['other', 'prevPhotos:', 'prevPhotos:../x', 'prevPhotos:p12345', 'prevPhotosp1'].some(lib.isFileKind)).toBe(false);
  });
});
