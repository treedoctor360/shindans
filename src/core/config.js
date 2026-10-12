// 設定ファイルの検証
// 設定ファイル（業務ごとの選択肢・定型文・判定の基準など）は外から読み込むので、
// 使う前に形を確かめる。不正なら使わず、前に使えていた設定で動かす。

import { RULE_TYPES } from './rules.js';

// このアプリが読める設定の版。形式を変えたら上げる
export const CONFIG_VERSION = 3; // 2: dbFormat（台帳の列）を追加 / 3: 一覧表への書き戻しの項目を追加

const LEVELS = ['info', 'warn', 'danger'];

// 規則の種類ごとに必要な項目
const RULE_FIELDS = {
  treeNoPattern: ['pattern'],
  statusNotice: ['status'],
  speciesNotice: ['pattern'],
  ratioAtLeast: ['items'],
  contains: ['field', 'anyOf'],
  conflict: ['when', 'hits'],
  noteSuggestsTreat: ['note', 'treat'],
  treatForbidden: ['pattern'],
  treatRequires: ['pattern', 'field', 'label'],
  gradeNeedsTreat: ['grades'],
  photoOver: [],
};
// 正規表現として読む項目
const REGEX_FIELDS = ['pattern', 'unless'];

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isArr = Array.isArray;
const isObj = (v) => v != null && typeof v === 'object' && !isArr(v);
const isCond = (c) => isObj(c) && isStr(c.field) && typeof c.eq === 'string';

// 検証する。返す形：{ ok: true/false, errors: ['…', …] }
export function validateConfig(cfg) {
  const e = [];
  const need = (ok, msg) => {
    if (!ok) e.push(msg);
    return ok;
  };

  if (!need(isObj(cfg), '設定が読めません（JSON の形ではありません）')) return { ok: false, errors: e };
  need(cfg.version === CONFIG_VERSION, `設定の版が違います（このアプリは ${CONFIG_VERSION}、設定は ${cfg.version}）`);

  need(isStr(cfg.deadVigor), 'deadVigor（枯死に当たる樹勢の値）がありません');
  need(isStr(cfg.vigorLabel) && isStr(cfg.gradeLabel), 'vigorLabel・gradeLabel（項目名）がありません');

  const c = cfg.calc;
  if (need(isObj(c), 'calc がありません')) {
    need(isNum(c.multiStemFactor) && c.multiStemFactor > 0 && c.multiStemFactor <= 1, 'calc.multiStemFactor は 0〜1 の数にしてください');
    need(isNum(c.pi) && c.pi > 3 && c.pi < 3.2, 'calc.pi は円周率の値にしてください');
    need(isNum(c.branchCap) && c.branchCap > 0, 'calc.branchCap は正の数にしてください');
    need(isStr(c.branchCapLabel) && isStr(c.deadLabel), 'calc.branchCapLabel・deadLabel がありません');
  }

  if (need(isArr(cfg.checks) && cfg.checks.length > 0, 'checks（点検項目）がありません')) {
    cfg.checks.forEach((x, i) => need(isStr(x?.key) && isStr(x?.label), `checks[${i}] に key と label が必要です`));
    const keys = cfg.checks.map((x) => x?.key);
    need(new Set(keys).size === keys.length, 'checks の key が重複しています');
  }

  if (need(isArr(cfg.details), 'details がありません'))
    cfg.details.forEach((d, i) => need(isCond(d?.when) && isStr(d?.field) && isStr(d?.label), `details[${i}] の形が違います`));

  need(isObj(cfg.initial) && isStr(cfg.initial.label) && isStr(cfg.initial.yes) && isStr(cfg.initial.no), 'initial（初期診断の必要性）の形が違います');

  if (need(isArr(cfg.noteChips), 'noteChips（定型文）がありません')) {
    cfg.noteChips.forEach((x, i) => need(isStr(x?.t) && ['n', 's'].includes(x?.kind), `noteChips[${i}] に t と kind（n か s）が必要です`));
    const ts = cfg.noteChips.map((x) => x?.t);
    need(new Set(ts).size === ts.length, 'noteChips の t が重複しています');
  }
  need(isObj(cfg.dbNote) && typeof cfg.dbNote.nounJoin === 'string' && typeof cfg.dbNote.nounSuffix === 'string', 'dbNote の形が違います');

  const t = cfg.treat;
  need(isObj(t) && isArr(t.prune) && isArr(t.other) && typeof t.pruneSuffix === 'string' && typeof t.join === 'string', 'treat（処置）の形が違います');

  need(isObj(cfg.species) && isArr(cfg.species.list) && isObj(cfg.species.replace), 'species（樹種）の形が違います');

  const p = cfg.photo;
  if (need(isObj(p), 'photo がありません')) {
    need(isStr(p.fullName) && isStr(p.flagYes) && isStr(p.flagNo), 'photo.fullName・flagYes・flagNo がありません');
    need(isNum(p.maxWeak) && p.maxWeak > 0, 'photo.maxWeak は正の数にしてください');
    need(isArr(p.weak) && p.weak.every((x) => isCond(x) && isStr(x.name)), 'photo.weak の形が違います');
    need(isArr(p.shared) && p.shared.every((x) => isCond(x) && isStr(x.name)), 'photo.shared の形が違います');
    need(isArr(p.fullOnly) && p.fullOnly.every(isCond), 'photo.fullOnly の形が違います');
  }

  if (need(isArr(cfg.rules), 'rules（判定支援の規則）がありません')) {
    const ids = new Set();
    cfg.rules.forEach((r, i) => {
      const at = `rules[${i}]${r?.id ? `（${r.id}）` : ''}`;
      if (!need(isObj(r) && isStr(r.id), `${at} に id が必要です`)) return;
      need(!ids.has(r.id), `${at} の id が重複しています`);
      ids.add(r.id);
      if (!need(RULE_TYPES.includes(r.type), `${at} の type「${r.type}」は使えません`)) return;
      need(LEVELS.includes(r.level), `${at} の level は info・warn・danger のどれかです`);
      need(isStr(r.message), `${at} に message が必要です`);
      RULE_FIELDS[r.type].forEach((f) => need(r[f] != null, `${at} に ${f} が必要です`));
      REGEX_FIELDS.forEach((f) => {
        if (r[f] == null) return;
        try {
          new RegExp(r[f]);
        } catch {
          e.push(`${at} の ${f} が正規表現として読めません`);
        }
      });
      if (r.type === 'ratioAtLeast')
        need(
          isArr(r.items) && r.items.every((it) => ['height', 'branch'].includes(it.ratio) && isNum(it.threshold) && isStr(it.label)),
          `${at} の items の形が違います`,
        );
      if (r.type === 'conflict') need(isCond(r.when) && isArr(r.hits) && r.hits.every((h) => isCond(h) && isStr(h.label)), `${at} の when・hits の形が違います`);
      if (r.actions != null)
        need(isArr(r.actions) && r.actions.every((a) => ['addTreat', 'addNote'].includes(a?.type) && isStr(a.value) && isStr(a.label)), `${at} の actions の形が違います`);
    });
  }

  validateDbFormat(cfg.dbFormat, need, e);

  return { ok: e.length === 0, errors: e };
}

// 台帳・一覧表の書式（見出しの探し方など）
function validateDbFormat(f, need, e) {
  if (!need(isObj(f), 'dbFormat（台帳・一覧表の書式）がありません')) return;
  need(Number.isInteger(f.headerRow) && f.headerRow >= 1, 'dbFormat.headerRow は1以上の整数にしてください');
  need(Number.isInteger(f.dataRow) && f.dataRow > f.headerRow, 'dbFormat.dataRow は見出し行より後ろの行にしてください');
  if (!need(isObj(f.columns) && isStr(f.columns.treeNo), 'dbFormat.columns に treeNo（樹木番号の見出し）が必要です')) return;
  for (const [k, re] of Object.entries(f.columns)) {
    try {
      new RegExp(re);
    } catch {
      e.push(`dbFormat.columns.${k} が正規表現として読めません`);
    }
  }
  const has = (k) => k in f.columns;
  need(
    isArr(f.sheets) && f.sheets.length > 0 && f.sheets.every((s) => isStr(s?.type) && isStr(s?.label) && has(s?.identify)),
    'dbFormat.sheets は type・label・identify（columns にある見出しのキー）の一覧にしてください',
  );
  need(isArr(f.infoKeys) && f.infoKeys.every(has), 'dbFormat.infoKeys は columns にあるキーの一覧にしてください');
  need(has(f.doneKey), 'dbFormat.doneKey は columns にあるキーにしてください');
  if (f.serialStatus != null) need(isObj(f.serialStatus) && has(f.serialKey), 'dbFormat.serialStatus を使うときは serialKey（columns にあるキー）が必要です');
  if (f.parenKeys != null)
    need(isObj(f.parenKeys) && Object.entries(f.parenKeys).every(([k, p]) => has(k) && isStr(p?.field)), 'dbFormat.parenKeys の形が違います');
  if (f.replace != null) need(isObj(f.replace) && Object.values(f.replace).every(isObj), 'dbFormat.replace の形が違います');
  // 書き戻し
  need(isArr(f.writeKeys) && f.writeKeys.length > 0 && f.writeKeys.every(has), 'dbFormat.writeKeys は columns にあるキーの一覧にしてください');
  need(has(f.serialKey) && typeof f.newSerial === 'string', 'dbFormat.serialKey・newSerial（一覧表にない木を足すときの通し番号欄）が必要です');
  if (f.serialFor != null) need(isObj(f.serialFor), 'dbFormat.serialFor の形が違います');
  if (f.heightRatioFormula != null)
    need(isStr(f.heightRatioFormula) && f.heightRatioFormula.includes('{height}') && f.heightRatioFormula.includes('{girth}'), 'dbFormat.heightRatioFormula には {height} と {girth} が必要です');
  if (f.parenKeys != null)
    need(Object.values(f.parenKeys).every((p) => isStr(p.when) && (p.alias == null || isObj(p.alias))), 'dbFormat.parenKeys には when（例「有」）が必要です');
}

// 新しい設定が正しければそれを、不正なら前の設定を使う
// 返す形：{ config, errors }（errors が空でなければ、画面で知らせる）
export function chooseConfig(next, previous) {
  const r = validateConfig(next);
  if (r.ok) return { config: next, errors: [] };
  return { config: previous ?? null, errors: r.errors };
}
