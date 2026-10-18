// 詳しい診断（初期診断など）の記録のテスト：対象・引き継ぎ・鍵・送受信・ブックとの二重入力・付箋
// IndexedDB は Node にないので、テスト用の代わり（fake-indexeddb）を使う
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { importInitialBook, initialState, migrate } from '../src/store/state.js';
import { bookEntry, bookValues, fillNone, initialOf, initialsForBook, initialStatus, initialTargets, inheritFrom, missingInitial, optionsOf, saveInitial, startInitial, updateInitial } from '../src/store/initial.js';
import { addSticky, answerSticky, closeSticky, fieldLabel, reviewFields, reviewState, reviewStatesOf, setConfirm, treeKey } from '../src/store/review.js';
import { applyPull, applyPush, outbox, pull, push } from '../src/store/sync.js';
import { INITIAL, initialKey } from '../src/store/surveys.js';
import { makeFakeGas } from './helpers/fakeGas.js';
import { makeInitialBook } from './helpers/makeInitialBook.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1', lastSeq: 0 };
const T = (no, o = {}) =>
  blankTree({ id: `ledger:${no}`, treeNo: no, siteType: 'park', parkCode: 'K01', parkName: '架空公園', place: '架空町', ledgerRow: { sheet: 's', row: 3 }, ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, server: { ...server }, ...o });
// 簡易診断で「詳しい診断が必要」と入力した木
const need = (no, o = {}) => T(no, { source: 'app', done: true, initialNeeded: '要', species: 'テストノキ', height: '12', girths: ['0.5', '0.3'], branchLen: '400', branchDia: '10', lean: '有', ...o });

async function sync(state, g) {
  const r = await push(state, cfg, g.fetchFn);
  const a = applyPush(state, r.results, r.tokens, cfg);
  const p = await pull(a.state, cfg, g.fetchFn);
  return applyPull(a.state, p.records, p.lastSeq, cfg).state;
}

describe('詳しい診断の対象と引き継ぎ', () => {
  it('対象は簡易診断で「必要」とした木（台帳の木も含む。削除した木は除く）', () => {
    const s = S([need('AB001'), T('AB002', { initialNeeded: '否', done: true }), T('AB003', { source: 'ledger', done: true, initialNeeded: '要' }), need('AB004', { deleted: true })]);
    expect(initialTargets(s, cfg).map((x) => [x.tree.treeNo, x.status])).toEqual([
      ['AB001', 'todo'],
      ['AB003', 'todo'],
    ]);
  });

  it('設定に詳しい診断がなければ、対象はない', () => {
    const c = structuredClone(cfgJson);
    delete c.initialSurvey;
    expect(initialTargets(S([need('AB001')]), c)).toEqual([]);
  });

  it('簡易診断の値を設定どおりに引き継ぐ（株立の幹周・枝長/枝径の上限・選択肢の言い換え・数は数で）', () => {
    const { values, keys } = inheritFrom(need('AB001'), cfg);
    expect(values).toEqual({
      species: 'テストノキ',
      place: '架空町',
      height: 12,
      girth: 0.64, // (0.5＋0.3)×0.8
      branchRatio: '30≦', // 40倍 → 「30倍以上」→ 言い換え
      lean: '有（危険）',
    });
    expect(keys).toEqual(['species', 'place', 'height', 'girth', 'branchRatio', 'lean']);
    // 台帳の木の枝長/枝径は、台帳の値
    expect(inheritFrom(T('X', { source: 'ledger', initialNeeded: '要', ledgerBranchRatio: '12.5' }), cfg).values.branchRatio).toBe(12.5);
  });

  it('記録を作ると、元の木と同じ見分け方の鍵になり、もう一度押しても2件にならない', () => {
    let s = S([need('AB001')]);
    const r1 = startInitial(s, s.trees[0], cfg, { now: 't1' });
    expect(r1.created).toBe(true);
    expect(initialKey(r1.record, cfg)).toBe(`initial|${treeKey(s.trees[0], cfg)}`);
    expect(r1.record).toMatchObject({ treeNo: 'AB001', siteType: 'park', dupIndex: 1, parkCode: 'K01', height: 12, done: false, source: 'app', inherited: expect.any(Array) });
    s = r1.state;
    const r2 = startInitial(s, s.trees[0], cfg);
    expect(r2.created).toBe(false);
    expect(s.initials).toHaveLength(1);
    expect(initialStatus(s.trees[0], s, cfg)).toBe('draft');
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true })) };
    expect(initialStatus(s.trees[0], s, cfg)).toBe('done');
    expect(initialOf(s, s.trees[0], cfg).id).toBe('ini:ledger:AB001');
  });

  it('追加した木（uid で見分ける木）も、同じ uid の鍵になる', () => {
    const t = need('ZZ9', { ledgerRow: undefined, id: 'new:1', uid: 'dev1-abc' });
    const { record } = startInitial(S([t]), t, cfg);
    expect(initialKey(record, cfg)).toBe('initial|2099|park|+dev1-abc|1');
  });

  it('対象でない木は記録を作らない', () => {
    const t = T('AB002', { initialNeeded: '否' });
    expect(() => startInitial(S([t]), t, cfg)).toThrow('対象ではない');
  });

  it('設定の引き継ぎの形を確かめる', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.inherit.x = { from: '@unknown' };
    expect(validateConfig(c).errors.join()).toContain('initialSurvey.inherit');
  });
});

describe('データ入力用ブックとの二重入力', () => {
  it('ブックに手で入力済みの木は「ブックで入力済み」になり、記録は作らない（force を付ければ作れる）', async () => {
    let s = S([need('AB009'), need('AB001')]);
    const r = await importInitialBook(s, 'book.xlsx', await makeInitialBook(), cfg, '2099-05-06');
    s = r.state;
    expect(s.initialBookInfo).toMatchObject({ name: 'book.xlsx', date: '2099-05-06', errors: [] });
    expect(s.initialBookInfo.filled).toContain('initial|park|K01|AB009');
    // 別の場所（K09）の同じ番号の行があっても、K01 の AB001 は対象のまま
    expect(initialTargets(s, cfg).map((x) => x.status)).toEqual(['book', 'todo']);
    expect(() => startInitial(s, s.trees[0], cfg)).toThrow('入力済み');
    const forced = startInitial(s, s.trees[0], cfg, { force: true }).state;
    expect(initialStatus(forced.trees[0], { ...forced, initials: forced.initials.map((x) => ({ ...x, done: true })) }, cfg)).toBe('both');
  });
});

describe('詳しい診断の記録の送受信と付箋', () => {
  it('入力済みにした記録は種類 initial で送られ、他の端末に届く。簡易診断の木とは別の記録', async () => {
    const g = makeFakeGas();
    let phone = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    phone = { ...phone, initials: phone.initials.map((r) => ({ ...r, done: true, b4: '有（小）', updatedAt: 'u2' })) };
    const { records } = outbox(phone, cfg);
    expect(records.map((x) => [x.kind, x.id])).toEqual([['initial', 'initial:initial|2099|park|AB001|1']]);
    phone = await sync(phone, g);
    expect(phone.initials[0]).toMatchObject({ rev: 1, sent: true });

    const office = await sync(S([T('AB001', { source: 'app', done: true, initialNeeded: '要' })], { server: { ...server, deviceId: 'pc' } }), g);
    expect(office.initials).toHaveLength(1);
    expect(office.initials[0]).toMatchObject({ treeNo: 'AB001', b4: '有（小）', done: true, rev: 1 });
    expect(office.trees[0].b4).toBeUndefined(); // 簡易診断の木には入らない
  });

  it('付箋は記録の種類ごとに分かれる（詳しい診断の付箋は、簡易診断の木の付箋にならない）', () => {
    let s = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, sent: true, rev: 1 })) };
    const r = addSticky(s, s.initials[0], { field: 'b4Detail', question: '高さは？' }, cfg, INITIAL);
    expect(r.state.stickies[r.id].treeId).toBe('initial|2099|park|AB001|1');
    expect(reviewState(r.state.initials[0], r.state, cfg, INITIAL)).toBe('asked');
    expect(reviewState(r.state.trees[0], r.state, cfg)).toBe('submitted');
  });

  it('付箋を付けられる項目は入力画面のすべての項目（弱点は詳細も）。採用すると記録に入り、数の項目は数のまま', () => {
    const fields = reviewFields(cfg, INITIAL);
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(['b4', 'b4Detail', 'height']));
    expect(fieldLabel('b4Detail', cfg, INITIAL)).toMatch(/（詳細）$/);
    expect(fieldLabel(null, cfg, INITIAL)).toBe('記録全体');

    let s = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, sent: true, rev: 1 })) };
    expect(s.initials[0].height).toBe(12);
    const a = addSticky(s, s.initials[0], { field: 'height', question: '樹高は？', proposal: '１３．５' }, cfg, INITIAL);
    const b = addSticky(a.state, a.state.initials[0], { field: 'b4', proposal: '有（小）' }, cfg, INITIAL);
    expect(reviewStatesOf(b.state.trees[0], b.state, cfg)).toEqual(['submitted', 'asked']);

    s = { ...b.state, user: { role: 'surveyor', name: '試験' } };
    s = answerSticky(s, a.id, { type: 'adopt' }, cfg);
    s = answerSticky(s, b.id, { type: 'adopt' }, cfg);
    expect(s.initials[0]).toMatchObject({ height: 13.5, b4: '有（小）', sent: false }); // 数は数のまま（全角でも）
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('answered');
    expect(() => setConfirm(s, s.initials[0], true, cfg, INITIAL)).toThrow('付箋');

    // 確認済みにして、送信済みになれば確定できる。確定した記録だけがブックに書き込む対象
    s = closeSticky(closeSticky(s, a.id), b.id);
    s = { ...s, initials: s.initials.map((r) => ({ ...r, sent: true, rev: 2 })) };
    s = setConfirm(s, s.initials[0], true, cfg, INITIAL);
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('confirmed');
    expect(initialsForBook(s, cfg).records.map((r) => r.treeNo)).toEqual(['AB001']);
    expect(s.confirms['initial|2099|park|AB001|1'].value).toBe(true);
    expect(s.confirms['2099|park|AB001|1']).toBeUndefined(); // 簡易診断の木は確定していない
  });
});

describe('入力画面の部品（並び・選択肢・すべて無・未入力・保存）', () => {
  it('設定の画面の並びを確かめる', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[0].items[0].type = 'slider';
    expect(validateConfig(c).errors.join()).toContain('initialSurvey.forms.initial.sections[0].items[0]');
    const d = structuredClone(cfgJson);
    d.initialSurvey.forms.initial.sections[1].items.push({ key: 'b4Detail', label: 'x', type: 'text' });
    expect(validateConfig(d).errors.join()).toContain('key が重複');
  });

  it('選択肢は設定にあればそれ、なければブックの入力規則から', async () => {
    let s = S([need('AB001')]);
    s = (await importInitialBook(s, 'b.xlsx', await makeInitialBook(), cfg, '2099-05-06')).state;
    const items = cfg.initialSurvey.forms.initial.sections.flatMap((x) => x.items);
    const lean = items.find((x) => x.key === 'lean');
    const b4 = items.find((x) => x.key === 'b4');
    expect(optionsOf(lean, s, 'initial', 'park')).toEqual(['無', '有（安全）', '有（危険）']);
    expect(optionsOf(b4, s, 'initial', 'park')).toEqual(['無', '有（小）', '有（大）']);
    expect(optionsOf(b4, S([]), 'initial', 'park')).toBeNull(); // ブックを読み込んでいなければない
  });

  it('「すべて無」は、まだ選んでいない選択肢の項目だけに入れる', () => {
    const sec = cfg.initialSurvey.forms.environment.sections[0];
    const opts = (it) => it.options || ['支柱なし', '無', '有'];
    const r = fillNone({ weather: '有' }, sec, cfg, opts);
    expect(r.record).toEqual({ weather: '有', stake: '無' });
    expect(r.keys).toEqual(['stake']);
  });

  it('未入力は現場の選択肢の項目だけ数え、保存で調査日・調査者を記録する', () => {
    let s = startInitial({ ...S([need('AB001')]), session: { date: '2099-05-06', inspector: '試験 二郎(資格)' } }, need('AB001'), cfg).state;
    const id = s.initials[0].id;
    // 不自然な傾斜は簡易診断から引き継いでいるので未入力ではない。枝長/枝径は「後で」の項目なので数えない
    expect(missingInitial(s.initials[0], cfg)).toEqual(['枯れ枝', '気象の影響', '支柱の損傷']);
    const r1 = saveInitial(s, id, cfg);
    expect(r1.saved).toBe(false);
    s = updateInitial(s, id, (r) => ({ ...r, b4: '無', weather: '無', stake: '支柱なし' }));
    const r2 = saveInitial(s, id, cfg, { now: 'u9' });
    expect(r2.saved).toBe(true);
    expect(r2.state.initials[0]).toMatchObject({ done: true, sent: false, year: 2099, month: 5, day: 6, inspector: '試験 二郎(資格)', updatedAt: 'u9' });
  });
});

describe('ブックに入力済みの木の中身', () => {
  it('ブックの行の中身を、場所のコードと番号で引ける（初期・環境をまとめる。行の番号は印として持つ）', async () => {
    const book = await makeInitialBook({ withAB001: true });
    let s = S([need('AB001'), need('AB002')]);
    s = (await importInitialBook(s, 'b.xlsx', book, cfg, '2099-05-06')).state;
    const e = bookEntry(s, s.trees[0], cfg);
    expect(e.initial).toMatchObject({ treeNo: 'AB001', b4: '有（大）', b4Detail: '2本、地上5m', height: 9.5, _sheet: '公園_詳しい診断', _row: 7 });
    expect(e.environment).toMatchObject({ stake: '有', _row: 5 });
    expect(bookValues(e, cfg)).toMatchObject({ b4: '有（大）', height: 9.5, stake: '有', weather: '無' });
    expect(bookValues(e, cfg)).not.toHaveProperty('_row');
    expect(bookValues(e, cfg)).not.toHaveProperty('serial');
    expect(bookEntry(s, s.trees[1], cfg)).toBeNull();
  });

  it('「アプリで入力し直す」は、ブックの値を下書きにする（簡易からの引き継ぎより優先）', async () => {
    let s = S([need('AB001')]);
    s = (await importInitialBook(s, 'b.xlsx', await makeInitialBook({ withAB001: true }), cfg, '2099-05-06')).state;
    const { record } = startInitial(s, s.trees[0], cfg, { force: true });
    expect(record).toMatchObject({ height: 9.5, b4: '有（大）', b4Detail: '2本、地上5m', stake: '有', girth: 0.64, done: false });
    expect(record.fromBook).toContain('height');
    expect(record.inherited).not.toContain('height'); // ブックの値を使ったので「簡易から」ではない
    expect(record.inherited).toContain('girth');
  });
});

describe('データ入力用ブックに書き込む記録の選び方', () => {
  it('入力済みの記録だけ。元の木が対象でなくなった記録は除いて知らせる。サーバーを使うときは確定した記録だけ', () => {
    let s = S([need('AB001'), need('AB002'), need('AB003')], { server: null });
    for (const t of s.trees) s = startInitial(s, t, cfg).state;
    s = saveInitial(s, 'ini:ledger:AB001', cfg, { force: true }).state;
    s = saveInitial(s, 'ini:ledger:AB002', cfg, { force: true }).state; // AB003 は入力中のまま
    s = { ...s, trees: s.trees.map((t) => (t.treeNo === 'AB002' ? { ...t, initialNeeded: '否' } : t)) }; // 後で「不要」に直した
    const r = initialsForBook(s, cfg);
    expect(r.records.map((x) => x.treeNo)).toEqual(['AB001']);
    expect(r.notTarget.map((x) => x.treeNo)).toEqual(['AB002']);

    const withServer = { ...s, server: { ...server } };
    expect(initialsForBook(withServer, cfg).records).toEqual([]);
    expect(initialsForBook(withServer, cfg).excluded.map((x) => x.treeNo)).toEqual(['AB001']);
    expect(initialsForBook(withServer, cfg).notTarget.map((x) => x.treeNo)).toEqual(['AB002']);
    expect(initialsForBook(withServer, cfg, { includeUnconfirmed: true }).records.map((x) => x.treeNo)).toEqual(['AB001']);
  });
});
