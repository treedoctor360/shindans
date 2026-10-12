// アプリの状態（入力した木・調査情報・読み込んだ設定など）と、その保存・読み込み
//
// 保存先（端末内の IndexedDB）
//  'state'    … 調査情報・木の一覧・表示中の画面など（入力のたびに保存）
//  'config'   … 設定ファイル（検証に通ったもの）
//  'template' … 野帳の原本 { name, buffer }
//  'ledger'   … 読み込んだ台帳 { name, date, buffer }（一覧表に書き戻すときの元ファイル）

import { chooseConfig } from '../core/config.js';
import { mergeLedger, readLedger } from '../excel/ledger.js';
import { idbGet, idbPut } from './idb.js';

// 保存する状態の形の版（形を変えたら上げ、migrate で古い形を直す）
export const STATE_VERSION = 1;

export function initialState() {
  return {
    stateVersion: STATE_VERSION,
    view: 'settings', // 'list' | 'form' | 'out' | 'settings'
    session: { date: '', inspector: '' }, // 調査情報（保存した木に記録する）
    trees: [],
    group: '', // 表示中の公園・路線
    currentId: '',
    ledgerInfo: null, // { name, date }
    templateName: '',
  };
}

// 古い形の状態を今の形に直す
export function migrate(s) {
  const base = initialState();
  if (!s || typeof s !== 'object') return base;
  return { ...base, ...s, session: { ...base.session, ...(s.session || {}) }, stateVersion: STATE_VERSION };
}

// 端末から読み込む
export async function loadAll() {
  const [state, config] = await Promise.all([idbGet('state'), idbGet('config')]);
  return { state: migrate(state), config: config ?? null };
}

export const saveState = (state) => idbPut('state', state);

// 設定ファイル（JSON の文字）を読み込む。不正なら保存せず、前の設定のまま
// 返す形：{ config, errors }
export async function loadConfigText(text, previous) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { config: previous, errors: ['JSON として読めません（ファイルが壊れているか、設定ファイルではありません）'] };
  }
  const r = chooseConfig(parsed, previous);
  if (!r.errors.length) await idbPut('config', r.config);
  return r;
}

// 野帳の原本を保存する
export async function saveTemplate(name, buffer) {
  await idbPut('template', { name, buffer });
}
export const loadTemplate = () => idbGet('template');

// 台帳を読み込んで、状態に取り込む。返す形：{ state, stats, sheets }
export async function importLedger(state, name, buffer, cfg, today) {
  const { rows, sheets } = await readLedger(buffer.slice(0), cfg);
  if (!rows.length) throw new Error('樹木番号の列が見つかりませんでした。台帳（樹木の一覧の Excel）を選んでください');
  const { trees, stats } = mergeLedger(state.trees, rows, cfg);
  await idbPut('ledger', { name, date: today, buffer });
  return { state: { ...state, trees, ledgerInfo: { name, date: today } }, stats, sheets };
}
export const loadLedgerFile = () => idbGet('ledger');
