// 必要な写真の判定
// どの入力でどの写真が要るかは、設定（cfg.photo と noteChips の photo / fullOnly）で決める。
//
// 判定の順：
//  1. 弱点写真が要る項目がある → 全景＋弱点写真
//  2. 全景で分かる弱点だけ    → 全景と共用（写真名「全景・〇〇」）
//  3. 写真で分からない弱点だけ → 全景のみ
//  4. どれもない              → 写真不要

import { chipsIn } from './notes.js';
import { isLocked, matches } from './tree.js';

export function photoPlan(tree, cfg) {
  const p = cfg.photo;
  if (!tree.vigor) return { slots: [], mode: 'pending', weakPhoto: false };

  const locked = isLocked(tree, cfg);
  const chips = locked ? [] : chipsIn(tree.notes, cfg);

  const weak = [];
  const add = (name) => {
    if (name && !weak.includes(name)) weak.push(name);
  };
  p.weak.filter((c) => matches(tree, c, cfg)).forEach((c) => add(c.name));
  chips.forEach((c) => add(c.photo));

  const shared = p.shared.filter((c) => matches(tree, c, cfg)).map((c) => c.name);
  const fullOnly = p.fullOnly.some((c) => matches(tree, c, cfg)) || chips.some((c) => c.fullOnly);

  const full = { key: 'full', name: shared.length ? [p.fullName, ...shared].join('・') : p.fullName, orient: p.fullOrient };
  const weakSlots = weak.map((n) => ({ key: 'w:' + n, name: n, orient: p.weakOrient }));

  if (weakSlots.length)
    return { slots: [full, ...weakSlots], mode: 'full+weak', weakPhoto: true, over: weakSlots.length > p.maxWeak };
  if (shared.length) return { slots: [full], mode: 'shared', weakPhoto: true };
  if (fullOnly) return { slots: [full], mode: 'fullOnly', weakPhoto: false };
  return { slots: [], mode: 'none', weakPhoto: false };
}

// 写真の有無（手で変えていればその値）
export const photoFlag = (tree, cfg) =>
  tree.photoOverride || (photoPlan(tree, cfg).weakPhoto ? cfg.photo.flagYes : cfg.photo.flagNo);
