// 弱点の「詳細」の文を、数字などの部品から組み立てる
//
// 現場では本数・高さ・大きさなどを部品ごとに入れ、アプリがブックの書き方の文にする。
//   例：本数 1、高さ 2、枝直径 18、枝長 4 → 「1本、地上2m、枝直径18cm、枝長4m」
// 部品の種類と書き方は設定（initialSurvey.detailParts）に置く。項目ごとに使う部品は、
// 項目の parts（部品の名前の並び）か、なければ initialSurvey.detailPartsDefault。
// 組み立てた文は手で直せる。手で直した後は、部品を変えても文を上書きしない（「部品から作り直す」で戻せる）。
//
// 部品の種類（type）と、入れる値の形・文の形：
//   count  … 数 '1'                         → 「1本」（unit 省略時「本」）
//   height … { a: '0', b: '0.7' }（b は省略可）→ 「地上0～0.7m」（prefix 省略時「地上」、unit 省略時「m」、sep 省略時「～」）
//   size   … [{ w: '20', h: '40' }, …]       → 「20×40cm、7×7cm（2箇所）」（unit 省略時「cm」。places を付けると2つ以上のとき箇所の数）
//              depth: true で奥行も（{ w, h, d }）。unitEach: true で数ごとに単位（「20cm×50cm×15cm」）
//   number … '18'                            → prefix＋値＋unit（例「枝直径18cm」）
//   choice … '＜1/3'（options から選ぶ）       → prefix＋値（例「周囲長比＜1/3」）
//   text   … '（種名など）'                    → そのまま
//   pair   … { a: '35', b: '100' }            → 「35cm/100cm」（unit・sep 省略時「/」）
//   flag   … true（押してあるか）               → text（例「（芯達）」）。「、」でつながず、前の文のすぐ後ろに付ける
//              attach: false なら、ほかの部品と同じく「、」でつなぐ（例「長さ1.5m、芯達」）

import { toHalf } from './text.js';

export const PART_TYPES = ['count', 'height', 'size', 'number', 'choice', 'text', 'pair', 'flag'];

// 部品の値を入れておく項目の名前（例 b4DetailParts）と、手で直したかの印の名前
export const partsKeyOf = (detailKey) => `${detailKey}Parts`;
export const manualKeyOf = (detailKey) => `${detailKey}Manual`;

const clean = (v) => toHalf(String(v ?? '')).trim();

// 項目で使う部品（設定の部品の定義に名前を付けたもの）。部品がなければ空
export function partsOf(item, cfg) {
  const defs = cfg.initialSurvey?.detailParts || {};
  const names = item.parts || cfg.initialSurvey?.detailPartsDefault || [];
  return names.filter((n) => defs[n]).map((n) => ({ name: n, ...defs[n] }));
}

// 部品1つの文（値がなければ空）
export function partText(part, v) {
  const unit = (d) => (part.unit != null ? part.unit : d);
  switch (part.type) {
    case 'count':
      return clean(v) ? `${clean(v)}${unit('本')}` : '';
    case 'height': {
      const a = clean(v?.a);
      const b = clean(v?.b);
      if (!a && !b) return '';
      const pre = part.prefix != null ? part.prefix : '地上';
      return a && b ? `${pre}${a}${part.sep || '～'}${b}${unit('m')}` : `${pre}${a || b}${unit('m')}`;
    }
    case 'size': {
      const u = unit('cm');
      const list = (Array.isArray(v) ? v : [])
        .map((x) => [clean(x?.w), clean(x?.h), part.depth ? clean(x?.d) : ''].filter(Boolean))
        .filter((x) => x.length)
        .map((x) => (part.unitEach ? x.map((n) => n + u).join('×') : `${x.join('×')}${u}`));
      if (!list.length) return '';
      return list.join('、') + (part.places && list.length > 1 ? `（${list.length}${part.places}）` : '');
    }
    case 'number':
      return clean(v) ? `${part.prefix || ''}${clean(v)}${unit('')}` : '';
    case 'choice':
      return clean(v) ? `${part.prefix || ''}${clean(v)}` : '';
    case 'text':
      return String(v ?? '').trim();
    case 'flag':
      return v ? part.text || '' : '';
    case 'pair': {
      const a = clean(v?.a);
      const b = clean(v?.b);
      if (!a && !b) return '';
      return `${a}${unit('')}${part.sep || '/'}${b}${unit('')}`;
    }
    default:
      return '';
  }
}

// 部品の値から文を作る（部品の並び順に、つなぎの文字でつなぐ。印（flag）は前の文のすぐ後ろに付ける）
export function buildText(values, parts, join = '、') {
  let out = '';
  for (const p of parts) {
    const t = partText(p, values?.[p.name]);
    if (!t) continue;
    const attach = p.type === 'flag' && p.attach !== false;
    out += out && !attach ? join + t : t;
  }
  return out;
}

// 部品の値から、詳細の文を作る
export function buildDetail(values, parts, cfg) {
  return buildText(values, parts, cfg.initialSurvey?.detailJoin ?? '、');
}

// 部品を1つ変えた記録を返す。手で直していなければ、詳細の文も作り直す
export function setPart(record, item, detailKey, name, value, cfg) {
  const pk = partsKeyOf(detailKey);
  const values = { ...(record[pk] || {}), [name]: value };
  const next = { ...record, [pk]: values };
  if (!record[manualKeyOf(detailKey)]) next[detailKey] = buildDetail(values, partsOf(item, cfg), cfg);
  return next;
}

// 詳細の文を手で直した記録を返す（部品を変えても上書きしない印を付ける）
export function setDetailText(record, detailKey, text) {
  return { ...record, [detailKey]: text, [manualKeyOf(detailKey)]: true };
}

// 部品から作り直した記録を返す（手で直した印を外す）
export function rebuildDetail(record, item, detailKey, cfg) {
  const next = { ...record, [detailKey]: buildDetail(record[partsKeyOf(detailKey)], partsOf(item, cfg), cfg) };
  delete next[manualKeyOf(detailKey)];
  return next;
}

// 部品の定義の一覧 { 名前: { type, label, … } } を確かめる（ほかの設定からも使う）。形が正しければ true
export function validatePartDefs(defs, at0, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!need(isObj(defs), `${at0} の形が違います`)) return false;
  for (const [name, p] of Object.entries(defs)) {
    const at = `${at0}.${name}`;
    if (!need(isObj(p) && PART_TYPES.includes(p.type) && typeof p.label === 'string' && p.label, `${at} は { type（${PART_TYPES.join('・')}）, label } の形にしてください`)) continue;
    if (p.type === 'choice') need(Array.isArray(p.options) && p.options.length > 0 && p.options.every((o) => typeof o === 'string'), `${at}：choice には options が必要です`);
    if (p.type === 'flag') need(typeof p.text === 'string' && p.text.length > 0, `${at}：flag には text（押したときに付ける文字）が必要です`);
    for (const k of ['prefix', 'unit', 'sep', 'places', 'text']) need(p[k] == null || typeof p[k] === 'string', `${at}.${k} は文字にしてください`);
    for (const k of ['depth', 'unitEach', 'attach']) need(p[k] == null || typeof p[k] === 'boolean', `${at}.${k} は true か false にしてください`);
  }
  return true;
}

// 設定の部品の定義を確かめる（config.js から呼ぶ）。need(条件, 誤りの文)
export function validateDetailParts(s, need) {
  if (s.detailParts == null) {
    const used = Object.values(s.forms || {}).some((f) => (f?.sections || []).some((sec) => (sec?.items || []).some((it) => it?.parts != null)));
    need(s.detailPartsDefault == null && !used, 'initialSurvey.detailPartsDefault や項目の parts を使うときは detailParts（部品の定義）が必要です');
    return;
  }
  if (!validatePartDefs(s.detailParts, 'initialSurvey.detailParts', need)) return;
  const names = new Set(Object.keys(s.detailParts));
  const check = (list, at) => need(Array.isArray(list) && list.every((n) => names.has(n)), `${at} に、detailParts にない部品があります`);
  if (s.detailPartsDefault != null) check(s.detailPartsDefault, 'initialSurvey.detailPartsDefault');
  for (const [form, f] of Object.entries(s.forms || {}))
    (f?.sections || []).forEach((sec, i) =>
      (sec?.items || []).forEach((it, j) => {
        if (it?.parts == null) return;
        need(it.type === 'weak', `initialSurvey.forms.${form}.sections[${i}].items[${j}]：parts は弱点の項目（weak）にだけ付けられます`);
        check(it.parts, `initialSurvey.forms.${form}.sections[${i}].items[${j}].parts`);
      }),
    );
  need(s.detailJoin == null || typeof s.detailJoin === 'string', 'initialSurvey.detailJoin は文字にしてください');
}
