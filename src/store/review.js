// 確認の流れ（事務と調査者のやり取り）
//
//  提出   … 調査者が入力・保存した木（サーバーへ自動送信）
//  確認依頼 … 事務が付箋（質問・修正案）を付け、調査者の返事を待っている
//  回答済み … 調査者が返事をした。事務が読んで「確認済み」にするのを待っている
//  確定   … 事務が確定した。確定した後で入力内容が変わったら、確定は外れる
//
// 入力内容を直すのは調査者だけ。事務の修正案は、調査者が「採用」したときに入力内容へ反映する。
// 付箋の持ち主：質問・修正案は書いた人（事務）、返事は調査者。両方が同時に書いても消し合わないよう、
// 送るときに「どちらを書いたか（edited）」を覚えておく。

import { toHalf } from '../core/text.js';
import { dbNoteOf } from '../core/notes.js';
import { touched, updateTree } from './actions.js';

// 木の鍵（年度・シートの種類・番号・何本目）。端末とサーバーで共通
export const treeKey = (t, cfg) => [cfg.job.year, t.siteType || '', toHalf(t.treeNo).trim(), t.dupIndex || 1].join('|');

// 付箋を付けられる項目（設定 review.fields があればそれ、なければ一般的な文字の項目）
export function reviewFields(cfg) {
  const base = cfg.review?.fields || [
    { key: 'dbNote', label: '一覧表用の特記' },
    { key: 'notes', label: '特記事項（野帳）' },
    { key: 'species', label: '樹種' },
    { key: 'treatFree', label: '処置（追記）' },
  ];
  return base;
}

// 項目の名前（null は木全体）
export const fieldLabel = (key, cfg) => (key ? reviewFields(cfg).find((f) => f.key === key)?.label || key : '木全体');

// 項目の今の値（一覧表用の特記は、自動で作った文も含める）
export const fieldValue = (tree, key, cfg) => (key === 'dbNote' ? dbNoteOf(tree, cfg) : String(tree?.[key] ?? ''));

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

// その木の付箋（消したものは除く）
export const stickiesOf = (state, key) => Object.values(state.stickies || {}).filter((s) => s.treeId === key && !s.deleted);

// 木の確認の段階
export function reviewState(tree, state, cfg) {
  if (!tree.done || tree.source !== 'app') return tree.source === 'ledger' ? 'ledger' : 'draft';
  const key = treeKey(tree, cfg);
  const st = stickiesOf(state, key);
  if (st.some((s) => !s.answer)) return 'asked';
  if (st.some((s) => s.answer && !s.closed)) return 'answered';
  const c = state.confirms?.[key];
  if (c?.value && c.treeRev === (tree.rev || 0) && tree.sent) return 'confirmed';
  return 'submitted';
}

export const REVIEW_LABEL = { draft: '未入力', ledger: '台帳で入力済み', submitted: '提出済み', asked: '確認依頼', answered: '回答済み', confirmed: '確定' };

// ---------- 事務の操作 ----------

// 付箋を付ける。field を null にすると木全体へのメモ
export function addSticky(state, tree, { field = null, question = '', proposal = null }, cfg) {
  const id = newId();
  const s = {
    id,
    treeId: treeKey(tree, cfg),
    field,
    question: String(question || '').trim(),
    proposal: proposal == null ? null : String(proposal),
    by: state.user?.name || '',
    at: now(),
    updatedAt: now(),
    answer: null,
    closed: false,
    deleted: false,
    rev: 0,
    dirty: true,
    edited: 'body',
  };
  return { state: { ...state, stickies: { ...(state.stickies || {}), [id]: s } }, id };
}

// 付箋を書き直す・消す・「確認済み」にする（事務）
export function editSticky(state, id, patch) {
  const s = state.stickies?.[id];
  if (!s) return state;
  return { ...state, stickies: { ...state.stickies, [id]: { ...s, ...patch, updatedAt: now(), dirty: true, edited: 'body' } } };
}
export const deleteSticky = (state, id) => editSticky(state, id, { deleted: true });
export const closeSticky = (state, id) => editSticky(state, id, { closed: true });

// 確定する・外す（事務）。確定できるのは、未解決の付箋がない、送信済みの木だけ
export function setConfirm(state, tree, value, cfg) {
  const key = treeKey(tree, cfg);
  if (value) {
    const rs = reviewState(tree, state, cfg);
    if (rs === 'asked' || rs === 'answered') throw new Error('未解決の付箋があるため、確定できません');
    if (!tree.sent) throw new Error('まだサーバーに届いていない入力があるため、確定できません');
  }
  const prev = state.confirms?.[key] || { rev: 0 };
  const c = { ...prev, treeId: key, value: !!value, treeRev: tree.rev || 0, by: state.user?.name || '', at: now(), updatedAt: now(), dirty: true };
  return { ...state, confirms: { ...(state.confirms || {}), [key]: c } };
}

// まとめて確定できる木（送信済み・付箋がすべて解決・まだ確定していない）
export const confirmable = (trees, state, cfg) => trees.filter((t) => reviewState(t, state, cfg) === 'submitted' && t.sent && !t.conflict);

// ---------- 調査者の操作 ----------

// 付箋に返事をする
//  type: 'adopt'（修正案を採用）/ 'keep'（このままで良い）/ 'edit'（自分で直す。text が新しい値）/ 'reply'（返事だけ）
export function answerSticky(state, id, { type, text = '' }, cfg) {
  const s = state.stickies?.[id];
  if (!s) return state;
  const answer = { type, text: String(text || ''), by: state.user?.name || '', at: now() };
  let next = { ...state, stickies: { ...state.stickies, [id]: { ...s, answer, updatedAt: now(), dirty: true, edited: 'answer' } } };
  const value = type === 'adopt' ? s.proposal : type === 'edit' ? answer.text : null;
  if (value != null && s.field) {
    const t = state.trees.find((x) => treeKey(x, cfg) === s.treeId);
    if (t)
      next = updateTree(next, t.id, (x) =>
        touched({ ...x, [s.field]: value, ...(s.field === 'dbNote' ? { dbNoteManual: true } : {}) }),
      );
  }
  return next;
}
