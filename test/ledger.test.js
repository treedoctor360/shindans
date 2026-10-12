// 台帳の読み込みと取り込みのテスト
// 台帳は実物を使わず、テストの中で ExcelJS を使って架空の台帳を作る
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { alertsOf } from '../src/core/rules.js';
import { blankTree } from '../src/core/tree.js';
import { mergeLedger, readLedger } from '../src/excel/ledger.js';

const cfg = structuredClone(cfgJson);

// 架空の台帳を作る
//  公園シート：見出しの並びは設定と違う順・改行入り。2行目は凡例
//  道路シート：同じ番号 AB001 があるが、別の木として扱う
//  関係ないシート：取り込まない
async function makeLedger() {
  const wb = new ExcelJS.Workbook();
  const park = wb.addWorksheet('公園');
  park.addRow(['連番', '公園コード', '公園名', '木の番号', '樹種', '調査日', '調査者', '樹高', '幹周', '樹高/幹径', '枝長/枝径', '①\n樹勢', '傾斜', '枯れ枝', '腐朽', 'キノコ', '特記', '詳しい診断\nの必要性', '健全度', '処置', '伐採理由', '写真']);
  park.addRow(['(凡例)', '', '', '番号を書く']);
  // 入力済み（日付・式・リッチテキスト・「有(…)」）
  park.addRow([1, 'K01', '架空公園', 'AB001', 'テストノキ', new Date(Date.UTC(2099, 3, 5)), '試験 一郎', 8.5, 0.5,
    { formula: 'ROUND((H3/(I3/3.14)),0)', result: 53 }, 12.345, '良', '無', '有(3本)', '無', '有(ツヨイタケ)',
    { richText: [{ text: '枝の偏りあり。' }, { text: '支柱は不要。', font: { bold: true } }] }, '〇', '', '枯れ枝剪定', '', '有']);
  // 未入力
  park.addRow([2, 'K01', '架空公園', 'ＡＢ００２', 'ミホンカエデ']);
  // 番号札なしで残っている木
  park.addRow(['残存', 'K02', '架空公園', 'AB003', '']);
  // 番号が重複した行（台帳の誤り。捨てずに別の木として取り込む）
  park.addRow([4, 'K09', '別の架空公園', 'AB001', '別の樹種']);
  // 番号が空の行（読まない）
  park.addRow([5, 'K01', '架空公園', '', 'テストノキ']);

  const road = wb.addWorksheet('道路');
  road.addRow(['連番', '木の番号', '道路番号', '道路名', '場所', '樹種', '樹勢']);
  road.addRow(['凡例']);
  road.addRow([1, 'AB001', 'R1', '架空通り', '北側', 'カクウザクラ', '']);

  const other = wb.addWorksheet('集計');
  other.addRow(['木の番号', '本数']);
  other.addRow(['', '']);
  other.addRow(['AB999', 1]);

  return wb.xlsx.writeBuffer();
}

describe('台帳の読み込み', () => {
  it('見本の設定（台帳の書式を含む）は正しい', () => expect(validateConfig(cfg)).toEqual({ ok: true, errors: [] }));

  it('見出しの文字で列を探し、対象のシートだけを読む', async () => {
    const { rows, sheets } = await readLedger(await makeLedger(), cfg);
    expect(sheets.map((s) => [s.name, s.type])).toEqual([['公園', 'park'], ['道路', 'street']]);
    expect(rows.map((r) => `${r.sheetType}:${r.values.treeNo}`)).toEqual(['park:AB001', 'park:ＡＢ００２', 'park:AB003', 'park:AB001', 'street:AB001']);
    const v = rows[0].values;
    expect(v.heightRatio).toBe(53); // 式は計算結果を読む
    expect(v.note).toBe('枝の偏りあり。支柱は不要。'); // リッチテキストは文字だけ
    expect(v.date).toBeInstanceOf(Date);
  });
});

describe('台帳の取り込み', () => {
  it('入力済みの木は台帳の値で読み取り専用にし、未入力の木は情報だけ入れる', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const { trees, stats } = mergeLedger([], rows, cfg);
    expect(stats).toEqual({ all: 5, done: 1, conflicts: 0, duplicates: ['AB001'] });

    const t1 = trees.find((t) => t.siteType === 'park' && t.treeNo === 'AB001');
    expect(t1).toMatchObject({
      source: 'ledger', done: true, species: 'テストノキ', parkCode: 'K01', parkName: '架空公園',
      ledgerDate: '2099-04-05', ledgerInspector: '試験 一郎', height: '8.5', girths: ['0.5'], ledgerBranchRatio: '12.35',
      vigor: '良', lean: '無', deadBranch: '有', deadBranchCount: '3', decay: '無', fungus: '有', fungusName: 'ツヨイタケ',
      notes: '・枝の偏りあり。\n・支柱は不要。', dbNote: '枝の偏りあり。支柱は不要。', dbNoteManual: true,
      initialNeeded: '要', grade: '', treatFree: '枯れ枝剪定', photoOverride: '有',
    });

    const t2 = trees.find((t) => t.treeNo === 'AB002'); // 全角の番号は半角にする
    expect(t2).toMatchObject({ source: 'app', done: false, species: 'ミホンカエデ' });
    expect(trees.find((t) => t.treeNo === 'AB003').status).toBe('残存');
    // 同じ番号でも道路のシートの木は別の木
    expect(trees.find((t) => t.siteType === 'street')).toMatchObject({ treeNo: 'AB001', routeName: '架空通り', place: '北側', source: 'app' });
  });

  it('アプリでも入力済みだった木は、台帳を正とし、アプリの入力を控えに残す', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const mine = blankTree({ id: 'a1', siteType: 'park', treeNo: 'AB001', done: true, height: '9.9', notes: '・アプリの特記' });
    const before = structuredClone(mine);
    const { trees, stats } = mergeLedger([mine], rows, cfg);
    const t = trees.find((x) => x.id === 'a1');
    expect(stats.conflicts).toBe(1);
    expect(t.height).toBe('8.5');
    expect(t.appBackup).toMatchObject({ height: '9.9', notes: '・アプリの特記', source: 'app' });
    expect(t.appBackup.appBackup).toBeUndefined();
    expect(mine).toEqual(before); // 元のデータは書き換えない
  });

  it('2回読み込んでも、控えが上書きされたり増えたりしない', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const mine = blankTree({ id: 'a1', siteType: 'park', treeNo: 'AB001', done: true, height: '9.9' });
    const once = mergeLedger([mine], rows, cfg).trees;
    const twice = mergeLedger(once, rows, cfg);
    expect(twice.stats.conflicts).toBe(0);
    expect(twice.trees.find((x) => x.id === 'a1').appBackup.height).toBe('9.9');
    expect(twice.trees.filter((x) => x.treeNo === 'AB001' && x.siteType === 'park')).toHaveLength(2); // 台帳の2行分のまま
  });

  it('台帳の順に並べ、台帳にないアプリの木は後ろに残す', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const extra = blankTree({ id: 'new1', siteType: 'park', treeNo: 'ZZ900', done: true });
    const { trees } = mergeLedger([extra], rows, cfg);
    expect(trees.map((t) => `${t.siteType}:${t.treeNo}`)).toEqual(['park:AB001', 'park:AB002', 'park:AB003', 'park:AB001', 'street:AB001', 'park:ZZ900']);
    expect(trees.at(-1)).toMatchObject({ id: 'new1', source: 'app', done: true });
  });

  it('台帳で番号が重複していても行を捨てず、別の木として注意を出す（再読み込みでも増えない）', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const once = mergeLedger([], rows, cfg).trees;
    const { trees } = mergeLedger(once, rows, cfg);
    const dups = trees.filter((t) => t.siteType === 'park' && t.treeNo === 'AB001');
    expect(dups.map((t) => [t.dupIndex, t.parkName, t.species, t.ledgerDuplicate])).toEqual([
      [1, '架空公園', 'テストノキ', 2],
      [2, '別の架空公園', '別の樹種', 2],
    ]);
    expect(dups[1].ledgerRow).toEqual({ sheet: '公園', row: 6 });
    expect(alertsOf(dups[1], cfg).map((a) => a.id)).toContain('ledgerDuplicate');
    // 重複していない木には出さない
    expect(trees.find((t) => t.siteType === 'street').ledgerDuplicate).toBe(0);
  });

  it('台帳の書式が不正なら設定の検証で止める', () => {
    const bad = structuredClone(cfg);
    bad.dbFormat.doneKey = 'ないキー';
    bad.dbFormat.columns.vigor = '(';
    const r = validateConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/doneKey/);
    expect(r.errors.join('\n')).toMatch(/columns.vigor/);
  });
});
