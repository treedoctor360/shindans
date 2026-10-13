// サーバー（GAS）とのやり取りのテスト
// gas/Code.js を「にせの Google」（test/helpers/fakeGas.js）の上でそのまま動かし、アプリ側の送信・取得と組み合わせて確かめる
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { callServer, fetchAll, fromBase64, getFile, markSent, mergeServerTrees, putFile, sendUnsent, toBase64, unsentTrees } from '../src/store/sync.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1' };
const P = (id, o = {}) => blankTree({ id, treeNo: id.toUpperCase(), siteType: 'park', parkName: '架空公園', ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, server, ...o });

describe('サーバーの計算部分（gas/Code.js）', () => {
  const { lib } = makeFakeGas();
  it('木のIDは年度・種類・番号・何本目', () => expect(lib.treeId({ siteType: 'park', treeNo: ' AB1 ', dupIndex: 2 }, 2099)).toBe('2099|park|AB1|2'));

  it('新しい木は追加、同じIDで新しければ上書き、古ければ取り込まない', () => {
    const rows = [['2099|park|AB1|1', 'AB1', 1, 'park', '', '2099-05-02T00:00:00Z', '', '', '{}']];
    const plan = lib.planUpsert(
      rows,
      [
        { treeNo: 'AB1', siteType: 'park', updatedAt: '2099-05-01T00:00:00Z' }, // 古い
        { treeNo: 'AB2', siteType: 'park', updatedAt: '2099-05-03T00:00:00Z' }, // 新規
        { treeNo: 'AB2', siteType: 'park', updatedAt: '2099-05-04T00:00:00Z' }, // 同じ送信の中の重複
        { treeNo: '', siteType: 'park' }, // 番号なしは送らない
      ],
      2099,
      'now',
      'dev1',
    );
    expect(plan.saved).toEqual(['2099|park|AB2|1']);
    expect(plan.conflicts).toEqual(['2099|park|AB1|1']);
    expect(plan.appends).toHaveLength(1);
    const plan2 = lib.planUpsert(rows, [{ treeNo: 'AB1', siteType: 'park', updatedAt: '2099-05-02T00:00:00Z' }], 2099, 'now', 'dev1');
    expect(plan2.updates.map((u) => u.index)).toEqual([0]); // 同じ時刻なら上書き（送り直し）
  });
});

describe('送信と取得（にせの Google で通しで確認）', () => {
  it('合言葉が違えば断る。サーバーに合言葉がなければ断る', async () => {
    const g = makeFakeGas();
    await expect(callServer({ ...server, pass: 'ちがう' }, { action: 'ping' }, g.fetchFn)).rejects.toThrow('合言葉が違います');
    await expect(callServer(server, { action: 'ping' }, makeFakeGas({ passphrase: '' }).fetchFn)).rejects.toThrow('PASSPHRASE');
    expect((await callServer(server, { action: 'ping' }, g.fetchFn)).ok).toBe(true);
  });

  it('入力済みでまだ送っていない木だけ送り、送れたら送信済みにする', async () => {
    const g = makeFakeGas();
    const s = S([
      P('a1', { done: true, updatedAt: '2099-05-01T00:00:00Z' }),
      P('a2', { done: true, sent: true, updatedAt: '2099-05-01T00:00:00Z' }),
      P('a3'), // 未入力
      P('a4', { done: true, source: 'ledger' }), // 台帳で入力済み
    ]);
    expect(unsentTrees(s).map((t) => t.id)).toEqual(['a1']);
    const r = await sendUnsent(s, cfg, g.fetchFn);
    expect(r.saved).toBe(1);
    expect(markSent(s, r.marks).trees.find((t) => t.id === 'a1').sent).toBe(true);
    const rows = g.sheets.get('trees').cells;
    expect(rows[0][0]).toBe('ID'); // 見出し
    expect(rows[1].slice(0, 5)).toEqual(['2099|park|A1|1', 'A1', 1, 'park', '架空公園']);
  });

  it('送信中に直した木は、送信済みにしない（次の送信でもう一度送る）', async () => {
    const g = makeFakeGas();
    const s = S([P('a1', { done: true, updatedAt: '2099-05-01T00:00:00Z' }), P('a2', { done: true, updatedAt: '2099-05-01T00:00:00Z' })]);
    const r = await sendUnsent(s, cfg, g.fetchFn);
    // 送信の返事が来る前に a1 を直した
    const latest = { ...s, trees: s.trees.map((t) => (t.id === 'a1' ? { ...t, height: '9', updatedAt: '2099-05-01T00:00:09Z' } : t)) };
    const after = markSent(latest, r.marks);
    expect(after.trees.map((t) => [t.id, !!t.sent])).toEqual([['a1', false], ['a2', true]]);
    expect(unsentTrees(after).map((t) => t.id)).toEqual(['a1']);
  });

  it('別の端末で送った木を、事務所の端末で取得できる（端末の古い入力は上書き、新しい未送信は残す）', async () => {
    const g = makeFakeGas();
    const phone = S([
      P('a1', { done: true, height: '8', updatedAt: '2099-05-02T00:00:00Z' }),
      P('a2', { done: true, height: '9', updatedAt: '2099-05-02T00:00:00Z' }),
      P('n1', { treeNo: 'ZZ900', done: true, status: '新規', updatedAt: '2099-05-02T00:00:00Z' }),
    ]);
    await sendUnsent(phone, cfg, g.fetchFn);

    const office = S([
      P('a1', { height: '' }), // まだ入力していない → サーバーの値になる
      P('a2', { done: true, height: '99', updatedAt: '2099-05-09T00:00:00Z' }), // 事務所で直した新しい未送信 → 残す
      P('x9', { source: 'ledger', done: true, treeNo: 'X9', parkName: '別公園' }),
    ]);
    const r = mergeServerTrees(office.trees, await fetchAll(office, cfg, g.fetchFn), cfg);
    expect([r.added, r.updated, r.kept]).toEqual([1, 1, 1]);
    const byNo = Object.fromEntries(r.trees.map((t) => [t.treeNo, t]));
    expect(byNo.A1).toMatchObject({ id: 'a1', height: '8', done: true, sent: true });
    expect(byNo.A2.height).toBe('99');
    expect(byNo.ZZ900).toMatchObject({ status: '新規', sent: true });
    expect(r.trees.map((t) => t.treeNo)).toEqual(['A1', 'A2', 'ZZ900', 'X9']); // 同じまとまりの最後に入る
  });

  it('台帳で入力済みの木は、サーバーの値で上書きしない', () => {
    const m = mergeServerTrees([P('a1', { source: 'ledger', done: true, height: '5' })], [P('s', { treeNo: 'A1', done: true, height: '8' })], cfg);
    expect(m.trees[0].height).toBe('5');
    expect(m.kept).toBe(1);
  });

  it('設定・原本・台帳のファイルを置いて、取り出せる（置き直すと前のファイルはゴミ箱へ）', async () => {
    const g = makeFakeGas();
    expect(await getFile(server, 'template', g.fetchFn)).toBeNull();
    const bytes = new Uint8Array(70000).map((_, i) => i % 251); // 大きめのファイル（分けて文字にする処理の確認）
    await putFile(server, 'template', '原本.xlsx', bytes.buffer, g.fetchFn);
    const f = await getFile(server, 'template', g.fetchFn);
    expect(f.name).toBe('原本.xlsx');
    expect(new Uint8Array(f.buffer)).toEqual(bytes);
    const firstId = g.props.get('FILE_template');
    await putFile(server, 'template', '原本2.xlsx', new Uint8Array([1]).buffer, g.fetchFn);
    expect(g.files.get(firstId).trashed).toBe(true);
    await expect(putFile(server, 'other', 'x', new Uint8Array([1]).buffer, g.fetchFn)).rejects.toThrow('種類');
  });

  it('【再発防止】スクリプトからスプレッドシートが見つからないとき：分かる言葉で知らせ、SPREADSHEET_ID があればそれを使う', async () => {
    const g = makeFakeGas({ bound: false });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await expect(putFile(server, 'config', 'c.json', bytes, g.fetchFn)).rejects.toThrow('SPREADSHEET_ID');
    await expect(sendUnsent(S([P('a1', { done: true, updatedAt: 'x' })]), cfg, g.fetchFn)).rejects.toThrow('SPREADSHEET_ID');
    g.props.set('SPREADSHEET_ID', 'ss');
    await putFile(server, 'config', 'c.json', bytes, g.fetchFn);
    const r = await sendUnsent(S([P('a1', { done: true, updatedAt: 'x' })]), cfg, g.fetchFn);
    expect(r.saved).toBe(1);
  });

  it('base64 の変換', () => {
    const b = new Uint8Array([0, 1, 254, 255]).buffer;
    expect(new Uint8Array(fromBase64(toBase64(b)))).toEqual(new Uint8Array(b));
  });
});
