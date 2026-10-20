// 調査日をまとめて直す（調査者の操作）
//
// 設定画面の調査日を間違えたまま保存した木を、公園・路線ごとにまとめて直す。
//  ・直すのは調査日だけ（調査者・ほかの入力内容は変えない）
//  ・その木の詳しい診断の記録も、調査日が同じなら一緒に直す
//  ・直した記録は普段の入力と同じく送る（版を確かめるので、黙って上書きはしない）
//  ・確定は外さない（調査日だけを直したことを dateFix に残す。review.js の reviewState）
//  ・別の端末との食い違いがある記録は直さない（先にどちらを使うか選ぶ）

import { initialOf } from './initial.js';
import { dateFixSig, dateKeysOf } from './review.js';
import { INITIAL, SIMPLE } from './surveys.js';

const ymd = (date) => String(date || '').split('-').map(Number);

// 記録の調査日（"2026-10-14" の形。詳しい診断は年・月・日の項目から作る）
export function recordDate(r, cfg, survey = SIMPLE) {
  if (survey.id !== INITIAL.id) return r.date || '';
  const [y, m, d] = dateKeysOf(cfg, survey).map((k) => Number(r[k]));
  return y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

// 調査日を変えた記録（確定を外さないための印 dateFix を付ける）
function withDate(r, to, cfg, survey, now) {
  // すでに日付だけを直した記録なら、確定したときの版を引き継ぐ
  const sig = dateFixSig(r, cfg, survey);
  const fromRev = r.dateFix && r.dateFix.sig === sig ? r.dateFix.fromRev : r.rev || 0;
  const next = { ...r, sent: false, updatedAt: now, dateFix: { fromRev, sig } };
  if (survey.id === INITIAL.id) {
    const [y, m, d] = ymd(to);
    const [ky, km, kd] = dateKeysOf(cfg, survey);
    Object.assign(next, { [ky]: y, [km]: m, [kd]: d });
  } else next.date = to;
  return next;
}

// 直せる木：アプリで入力済み・削除していない・食い違いがない・調査日が from
const canFix = (r) => r.done && r.source === 'app' && !r.deleted;

// 直す対象を数える（実行する前に見せる）。trees：その公園・路線の木
//  返す形：{ trees: [木], initials: [詳しい診断の記録], conflicts: [食い違いがあって直せない木・記録] }
export function redateTargets(state, cfg, trees, from) {
  const out = { trees: [], initials: [], conflicts: [] };
  if (!from) return out;
  for (const t of trees) {
    if (canFix(t) && t.date === from) (t.conflict ? out.conflicts : out.trees).push(t);
    const r = cfg.initialSurvey ? initialOf(state, t, cfg) : null;
    if (r && canFix(r) && recordDate(r, cfg, INITIAL) === from) (r.conflict ? out.conflicts : out.initials).push(r);
  }
  return out;
}

// 調査日の一覧（その公園・路線の、アプリで入力済みの木と詳しい診断の記録の調査日と本数）。新しい日付が先
export function datesOf(state, cfg, trees) {
  const n = new Map();
  for (const t of trees) {
    if (canFix(t) && t.date) n.set(t.date, (n.get(t.date) || 0) + 1);
    const r = cfg.initialSurvey ? initialOf(state, t, cfg) : null;
    const d = r && canFix(r) ? recordDate(r, cfg, INITIAL) : '';
    if (d && !(canFix(t) && t.date === d)) n.set(d, n.get(d) || 0); // 木と違う日付の記録も選べるように
  }
  return [...n.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({ date, count }));
}

// 直す。treeIds：その公園・路線の木の id（実行の時点の最新の状態から対象を選び直す）
//  返す形：{ state, trees（直した本数）, initials（直した記録の数）, conflicts（直せなかった数） }
export function redate(state, cfg, treeIds, from, to, now = new Date().toISOString()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('正しい調査日を選んでください');
  if (from === to) throw new Error('同じ日付です');
  const ids = new Set(treeIds);
  const tg = redateTargets(state, cfg, state.trees.filter((t) => ids.has(t.id)), from);
  const tIds = new Set(tg.trees.map((t) => t.id));
  const iIds = new Set(tg.initials.map((r) => r.id));
  const next = {
    ...state,
    trees: state.trees.map((t) => (tIds.has(t.id) ? withDate(t, to, cfg, SIMPLE, now) : t)),
    ...(iIds.size ? { [INITIAL.list]: state[INITIAL.list].map((r) => (iIds.has(r.id) ? withDate(r, to, cfg, INITIAL, now) : r)) } : {}),
  };
  return { state: next, trees: tIds.size, initials: iIds.size, conflicts: tg.conflicts.length };
}
