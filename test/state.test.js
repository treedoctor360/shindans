// 端末内の保存と、設定・台帳の読み込みのテスト
// IndexedDB は Node にないので、テスト用の代わり（fake-indexeddb）を使う
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { idbGet, idbPut, idbReset } from '../src/store/idb.js';
import { importLedger, initialState, loadAll, loadConfigText, migrate, saveState } from '../src/store/state.js';
import { blankTree } from '../src/core/tree.js';
import { makeLedger } from './helpers/makeLedger.js';

const cfg = structuredClone(cfgJson);

beforeEach(async () => {
  await idbReset();
  indexedDB.deleteDatabase('shindans');
});

describe('端末内の保存', () => {
  it('保存した値を読み戻せる（ファイルの中身も）', async () => {
    await idbPut('x', { a: 1 });
    await idbPut('bin', new Uint8Array([1, 2, 3]).buffer);
    expect(await idbGet('x')).toEqual({ a: 1 });
    expect([...new Uint8Array(await idbGet('bin'))]).toEqual([1, 2, 3]);
    expect(await idbGet('none')).toBeUndefined();
  });

  it('初めて開いたときは空の状態、保存すれば次回はその状態', async () => {
    expect((await loadAll()).state).toEqual(initialState());
    const s = { ...initialState(), session: { date: '2099-04-05', inspector: '試験 一郎' }, trees: [blankTree({ id: 't1' })] };
    await saveState(s);
    await idbReset(); // アプリを開き直したのと同じ
    expect((await loadAll()).state).toEqual(s);
  });

  it('古い形・壊れた状態でも起動できる形に直す', () => {
    expect(migrate(null)).toEqual(initialState());
    expect(migrate({ trees: [1], session: { date: 'x' } })).toMatchObject({ trees: [1], session: { date: 'x', inspector: '' }, view: 'settings' });
  });
});

describe('設定ファイルの読み込み', () => {
  it('正しい設定は保存して使う', async () => {
    const r = await loadConfigText(JSON.stringify(cfg), null);
    expect(r.errors).toEqual([]);
    expect((await loadAll()).config).toEqual(cfg);
  });

  it('壊れた JSON・不正な設定は保存せず、前の設定のまま', async () => {
    const prev = await loadConfigText(JSON.stringify(cfg), null);
    const bad1 = await loadConfigText('{ こわれた', prev.config);
    expect(bad1.config).toBe(prev.config);
    expect(bad1.errors[0]).toMatch(/JSON/);
    const bad2 = await loadConfigText(JSON.stringify({ ...cfg, version: 99 }), prev.config);
    expect(bad2.config).toBe(prev.config);
    expect((await loadAll()).config.version).toBe(cfg.version);
  });
});

describe('台帳の読み込み', () => {
  it('木を取り込み、元のファイルも保存する（一覧表へ書き戻すときに使う）', async () => {
    const buf = await makeLedger();
    const r = await importLedger(initialState(), '架空の台帳.xlsx', buf, cfg, '2099-04-10');
    expect(r.stats.all).toBe(5);
    expect(r.state.trees.length).toBe(5);
    expect(r.state.ledgerInfo).toEqual({ name: '架空の台帳.xlsx', date: '2099-04-10' });
    const saved = await idbGet('ledger');
    expect(saved.name).toBe('架空の台帳.xlsx');
    expect(saved.buffer.byteLength).toBe(buf.byteLength);
  });

  it('台帳でないファイルなら知らせる', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('関係ない').addRow(['a', 'b']);
    await expect(importLedger(initialState(), 'x.xlsx', await wb.xlsx.writeBuffer(), cfg, '2099-04-10')).rejects.toThrow(/樹木番号の列/);
  });
});
