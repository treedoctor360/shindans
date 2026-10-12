// 木1本のデータについての共通の判定

// 樹勢が「枯死」に当たる値か（どの値が枯死かは設定 cfg.deadVigor）
export const isDead = (tree, cfg) => !!tree.vigor && tree.vigor === cfg.deadVigor;

// 点検項目（cfg.checks）を「原則空欄」として扱うか
//  枯死の木は原則空欄。ただし「緊急の弱点を入力する」を押した木（deadOverride）は入力できる
export const isLocked = (tree, cfg) => isDead(tree, cfg) && !tree.deadOverride;

// 点検項目のキーか
export const isCheckKey = (key, cfg) => cfg.checks.some((c) => c.key === key);

// 条件 { field, eq } に当てはまるか
//  原則空欄の木では、点検項目についての条件は当てはまらないものとする
export function matches(tree, cond, cfg) {
  if (isLocked(tree, cfg) && isCheckKey(cond.field, cfg)) return false;
  return tree[cond.field] === cond.eq;
}

// 新しい木の空データ（画面・保存で使う形の見本）
export function blankTree(fields = {}) {
  return {
    id: '',
    treeNo: '',
    species: '',
    status: '',
    source: 'app', // 'app' = アプリで入力 / 'ledger' = 台帳で入力済み
    height: '',
    girths: [''],
    branchLen: '',
    branchDia: '',
    vigor: '',
    deadOverride: false,
    notes: '',
    dbNote: '',
    dbNoteManual: false,
    initialNeeded: '',
    grade: '',
    treatSel: [],
    treatFree: '',
    photoOverride: '',
    dismissed: [], // 「不要」と判断した提案のID
    ...fields,
  };
}
