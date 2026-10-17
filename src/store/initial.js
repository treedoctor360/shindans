// 詳しい診断（初期診断など）の記録
//
// 簡易診断で「詳しい診断が必要」とした木が対象。1本の木に記録は1件（鍵は surveys.js の initialKey）。
// 記録を作るときに、簡易診断の値（樹高・幹周など）を設定 initialSurvey.inherit に従って写す（引き継ぎ）。
// 記録の項目名は、データ入力用ブックの項目のキー（設定 initialSurvey.book の columns）と同じにする。
//
// データ入力用ブックに手で入力済みの木は「ブックで入力済み」として、二重入力にならないよう知らせる。

import { branchRatioCell, girthOf, heightRatioOf } from '../core/calc.js';
import { toHalf } from '../core/text.js';
import { bookKey } from '../excel/initialBook.js';
import { INITIAL, initialKey, simpleKey } from './surveys.js';

const round2 = (x) => Math.round(x * 100) / 100;

// 詳しい診断の対象か（簡易診断で「必要」。削除した木は除く）
export const isInitialTarget = (tree, cfg) => !!cfg.initialSurvey && !tree.deleted && tree.initialNeeded === cfg.initial.yes;

// その木の記録（なければ null）
export function initialOf(state, tree, cfg) {
  const key = `initial|${simpleKey(tree, cfg)}`;
  return (state.initials || []).find((r) => initialKey(r, cfg) === key) || null;
}

// データ入力用ブックで入力済みか（読み込んだブックの、入力済みの行の一覧から）
export function inBook(state, tree, cfg) {
  const filled = state.initialBookInfo?.filled;
  if (!filled?.length) return false;
  const codeKey = cfg.dbFormat.sheets.find((x) => x.type === tree.siteType)?.code;
  return filled.includes(bookKey('initial', tree.siteType, codeKey ? tree[codeKey] : '', tree.treeNo));
}

// 詳しい診断の進み具合
//  'todo'（まだ記録がない）/ 'draft'（入力中）/ 'done'（入力済み）/ 'book'（ブックで入力済み）/ 'both'（アプリとブックの両方で入力済み）
export function initialStatus(tree, state, cfg) {
  const r = initialOf(state, tree, cfg);
  const book = inBook(state, tree, cfg);
  if (r?.done) return book ? 'both' : 'done';
  if (book) return 'book';
  return r ? 'draft' : 'todo';
}

// ブックで入力済みの木の本数（詳しい診断のシートの分だけ数える。植栽環境などのシートは数えない）
export const bookCount = (info) => (info?.filled || []).filter((k) => k.startsWith('initial|')).length;

export const INITIAL_STATUS_LABEL = { todo: '未入力', draft: '入力中', done: '入力済み', book: 'ブックで入力済み', both: 'アプリとブックの両方で入力済み' };

// 引き継ぎの値を1つ取り出す
//  from：簡易診断の木の項目名。「@」で始まるものは計算した値
//    @girth（幹周。株立は係数をかけた値）/ @heightRatio（樹高/幹径）/ @branchRatio（枝長/枝径。上限以上は表記の文字）
function sourceValue(tree, from, cfg) {
  if (from === '@girth') return girthOf(tree, cfg);
  if (from === '@heightRatio') return heightRatioOf(tree, cfg);
  if (from === '@branchRatio') {
    if (tree.source === 'ledger') return tree.ledgerBranchRatio || '';
    const c = branchRatioCell(tree, cfg);
    return typeof c === 'number' ? round2(c) : c;
  }
  const v = tree[from];
  return Array.isArray(v) ? v.join('・') : v;
}

// 簡易診断の木から、引き継ぐ値を作る。返す形：{ values: { 項目: 値 }, keys: [引き継いだ項目…] }
export function inheritFrom(tree, cfg) {
  const values = {};
  const keys = [];
  for (const [key, spec] of Object.entries(cfg.initialSurvey?.inherit || {})) {
    const s = typeof spec === 'string' ? { from: spec } : spec;
    let v = sourceValue(tree, s.from, cfg);
    if (v == null || v === '') continue;
    if (s.map && Object.prototype.hasOwnProperty.call(s.map, String(v))) v = s.map[String(v)];
    // 数字の文字は数にする（ブックの数の欄に、文字ではなく数で書くため）
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(toHalf(v).trim())) v = Number(toHalf(v).trim());
    values[key] = v;
    keys.push(key);
  }
  return { values, keys };
}

// 記録を作る（すでにあれば何もしない）。返す形：{ state, record, created }
//  元の木を見分ける項目（シートの種類・番号・何本目・uid）と場所の情報を写し、簡易診断の値を引き継ぐ
//  ブックで入力済みの木は、force を付けたときだけ作る
export function startInitial(state, tree, cfg, { now = new Date().toISOString(), force = false } = {}) {
  if (!isInitialTarget(tree, cfg)) throw new Error('詳しい診断の対象ではない木です');
  const found = initialOf(state, tree, cfg);
  if (found) return { state, record: found, created: false };
  if (inBook(state, tree, cfg) && !force) throw new Error('データ入力用ブックに入力済みの木です（二重入力になります）');
  const copy = {};
  for (const k of ['siteType', 'treeNo', 'dupIndex', 'uid', 'species', ...cfg.dbFormat.infoKeys])
    if (tree[k] !== undefined && tree[k] !== '') copy[k] = tree[k];
  const { values, keys } = inheritFrom(tree, cfg);
  const record = {
    id: `ini:${tree.id}`,
    ...copy,
    ...values,
    inherited: keys, // 簡易診断から写した項目（画面で「簡易から」と示す）
    source: 'app',
    done: false,
    sent: false,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, [INITIAL.list]: [...(state[INITIAL.list] || []), record] }, record, created: true };
}

// 対象の木の一覧（並びは木の一覧のまま）。返す形：[{ tree, record, status }]
export function initialTargets(state, cfg, trees = state.trees) {
  return trees
    .filter((t) => isInitialTarget(t, cfg))
    .map((tree) => ({ tree, record: initialOf(state, tree, cfg), status: initialStatus(tree, state, cfg) }));
}
