// 簡易診断の特記事項に足す「寸法」の1行を、数字から作る
//
// 腐朽・空洞・鋼棒貫入などの大きさを、数字の欄に入れるだけで決まった書き方の1行にする
// （記号や単位を打つ手間を省く）。書き方は設定 noteMeasures に置く：
//   places … 部位の選択肢（例 ["枝", "幹"]）
//   parts  … 数字の欄の定義（種類は detailParts.js の PART_TYPES と同じ）
//   kinds  … 寸法の種類 [{ key, label, parts: [欄の名前…] }]
//   line   … 1行の形（省略時「{place}の{kind}：{text}」）
// 作った1行は特記事項（野帳）に足すだけで、ほかの項目は変えない。足した後は手で直せる。

import { buildText, validatePartDefs } from './detailParts.js';

export const measureKinds = (cfg) => cfg.noteMeasures?.kinds || [];

// 種類で使う数字の欄（定義に名前を付けたもの）
export function measureParts(kindKey, cfg) {
  const m = cfg.noteMeasures;
  const kind = (m?.kinds || []).find((k) => k.key === kindKey);
  if (!kind) return [];
  return kind.parts.filter((n) => m.parts?.[n]).map((n) => ({ name: n, ...m.parts[n] }));
}

// 1行を作る。部位・種類が選ばれていない、または数字が何もなければ空
export function measureLine(cfg, kindKey, place, values) {
  const m = cfg.noteMeasures;
  const kind = (m?.kinds || []).find((k) => k.key === kindKey);
  if (!kind || !place) return '';
  const text = buildText(values, measureParts(kindKey, cfg), m.join ?? '、');
  if (!text) return '';
  return (m.line || '{place}の{kind}：{text}').replace('{place}', place).replace('{kind}', kind.label).replace('{text}', text);
}

// 特記事項の最後に1行足す（定型文の行と同じく頭に「・」。最後の空行は詰める）
export function appendNoteLine(notes, line) {
  const base = String(notes || '').replace(/\s+$/, '');
  return base ? `${base}\n・${line}` : `・${line}`;
}

// 設定を確かめる（config.js から呼ぶ）。need(条件, 誤りの文)
export function validateNoteMeasures(m, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const isStr = (x) => typeof x === 'string' && x.length > 0;
  if (!need(isObj(m), 'noteMeasures の形が違います')) return;
  need(Array.isArray(m.places) && m.places.length > 0 && m.places.every(isStr), 'noteMeasures.places（部位の選択肢）を1つ以上の文字で書いてください');
  need(m.line == null || (isStr(m.line) && m.line.includes('{text}')), 'noteMeasures.line は {text} を含む文字にしてください');
  need(m.join == null || typeof m.join === 'string', 'noteMeasures.join は文字にしてください');
  const okDefs = validatePartDefs(m.parts, 'noteMeasures.parts', need);
  if (!need(Array.isArray(m.kinds) && m.kinds.length > 0, 'noteMeasures.kinds（寸法の種類）がありません')) return;
  const keys = new Set();
  m.kinds.forEach((k, i) => {
    const at = `noteMeasures.kinds[${i}]`;
    if (!need(isObj(k) && isStr(k.key) && isStr(k.label) && Array.isArray(k.parts) && k.parts.length > 0, `${at} は { key, label, parts: [欄の名前…] } の形にしてください`)) return;
    need(!keys.has(k.key), `${at}：key「${k.key}」が重複しています`);
    keys.add(k.key);
    if (okDefs) need(k.parts.every((n) => m.parts[n]), `${at}.parts に、noteMeasures.parts にない欄があります`);
  });
}
