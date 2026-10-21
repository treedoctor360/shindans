// 文がセルの枠（結合したセルの範囲）に収まるかを見積もり、収まる文字の大きさを選ぶ
//
// 確認用カルテのように、決まった大きさの枠に長さの違う文を書くときに使う。
// Excel の本当の描き方は分からないので、文字の幅は「全角は文字の大きさと同じ、半角はその半分強（文字ごとに幅が変わるフォントは約半分）」と見積もる。
// 見積もりは少し大きめ（収まらない側）にして、はみ出しを防ぐ。
//
//  枠の大きさ：列の幅（文字数）→ ポイント、行の高さ（ポイント）の合計
//  文字の大きさは、元の大きさから 0.5pt ずつ下げて、最小（既定 7pt）まで。折り返して何行入るかで決める

import { colNumber, splitAddress } from './xmlCells.js';

const MAX_DIGIT_PX = 7; // 標準の文字（11pt）の数字1文字の幅（px）。列の幅の単位
const colPt = (w) => Math.trunc(w * MAX_DIGIT_PX + 5) * 0.75; // 列の幅（文字数）→ pt

// シートの XML から、列の幅・行の高さ・結合の範囲を読む
export function sheetGeometry(xml) {
  const fmt = xml.match(/<sheetFormatPr\b[^>]*>/)?.[0] || '';
  const defCol = Number(fmt.match(/\bdefaultColWidth="([\d.]+)"/)?.[1] ?? (Number(fmt.match(/\bbaseColWidth="(\d+)"/)?.[1] ?? 8) + 0.71));
  const defRow = Number(fmt.match(/\bdefaultRowHeight="([\d.]+)"/)?.[1] ?? 13.5);
  const cols = [];
  for (const m of xml.matchAll(/<col\b[^>]*>/g)) {
    const min = Number(m[0].match(/\bmin="(\d+)"/)?.[1]);
    const max = Number(m[0].match(/\bmax="(\d+)"/)?.[1]);
    const w = Number(m[0].match(/\bwidth="([\d.]+)"/)?.[1]);
    const hidden = /\bhidden="(1|true)"/.test(m[0]);
    if (min && max && !Number.isNaN(w)) cols.push({ min, max, w: hidden ? 0 : w });
  }
  const rows = new Map();
  for (const m of xml.matchAll(/<row\b[^>]*>/g)) {
    const r = Number(m[0].match(/\br="(\d+)"/)?.[1]);
    const ht = m[0].match(/\bht="([\d.]+)"/)?.[1];
    const hidden = /\bhidden="(1|true)"/.test(m[0]);
    if (r) rows.set(r, hidden ? 0 : ht != null ? Number(ht) : defRow);
  }
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)].map((m) => {
    const a = splitAddress(m[1]);
    const b = splitAddress(m[2]);
    return { c1: colNumber(a.col), r1: a.row, c2: colNumber(b.col), r2: b.row };
  });
  const colW = (c) => colPt(cols.find((x) => c >= x.min && c <= x.max)?.w ?? defCol);
  const rowH = (r) => rows.get(r) ?? defRow;
  // セルの枠（結合していれば結合の範囲）の幅・高さ（pt）
  return (addr) => {
    const a = splitAddress(addr);
    const c = colNumber(a.col);
    const m = merges.find((x) => c >= x.c1 && c <= x.c2 && a.row >= x.r1 && a.row <= x.r2) || { c1: c, c2: c, r1: a.row, r2: a.row };
    let width = 0;
    for (let i = m.c1; i <= m.c2; i++) width += colW(i);
    let height = 0;
    for (let i = m.r1; i <= m.r2; i++) height += rowH(i);
    return { width, height };
  };
}

// 1文字の幅（文字の大きさに対する割合）。全角は 1。半角は、等幅のフォントなら 0.6（少し大きめに見積もる）、
// 文字ごとに幅が変わるフォント（ＭＳ Ｐゴシックなど）なら 0.52（半角の数字・英字は全角の約半分）
const HALF = /[\u0000-\u00ff\uff61-\uff9f]/;
const charW = (ch, proportional) => (HALF.test(ch) ? (proportional ? 0.52 : 0.6) : 1);

// 文字ごとに幅が変わるフォントか（名前で見分ける。分からないフォントは等幅として大きめに見積もる）
const MONO = /ＭＳ ゴシック|ＭＳ 明朝|MS Gothic|MS Mincho|Mono|Courier/i;
const PROP = /Ｐ|PGothic|PMincho|UI Gothic|Meiryo|メイリオ|游|Yu Gothic|Yu Mincho|Calibri|Arial|Hiragino|ヒラギノ/i;
export const isProportional = (fontName) => !!fontName && !MONO.test(fontName) && PROP.test(fontName);

// 文字の大きさ size（pt）で、幅 width（pt）に折り返したときの行の数。proportional：文字ごとに幅が変わるフォントか
export function linesNeeded(text, size, width, proportional = false) {
  const usable = Math.max(1, width - 4); // 左右の余白
  let lines = 0;
  for (const para of String(text).split('\n')) {
    let x = 0;
    let n = 1;
    for (const ch of para) {
      const w = charW(ch, proportional) * size;
      if (x + w > usable && x > 0) {
        n++;
        x = 0;
      }
      x += w;
    }
    lines += n;
  }
  return lines;
}

// 枠に入る行の数（行の高さは文字の大きさの 1.3 倍と見積もる）
const linesFit = (size, height) => Math.max(1, Math.floor((height - 2) / (size * 1.3)));

// 収まる文字の大きさを選ぶ。返す形：{ size, wrap, fits }
//  元の大きさで1行に収まれば { size: base, wrap: false, fits: true }（何も変えない）
//  そうでなければ、折り返して収まる一番大きい大きさ（min まで）。min でも収まらなければ fits: false
//  proportional：文字ごとに幅が変わるフォントか（isProportional）
export function fitSize(text, box, base, min = 7, proportional = false) {
  const s = String(text ?? '');
  if (!s || !box.width) return { size: base, wrap: false, fits: true };
  if (!s.includes('\n') && linesNeeded(s, base, box.width, proportional) === 1) return { size: base, wrap: false, fits: true };
  for (let size = base; size >= min - 1e-9; size = Math.round((size - 0.5) * 10) / 10) {
    if (linesNeeded(s, size, box.width, proportional) <= linesFit(size, box.height)) return { size, wrap: true, fits: true };
  }
  return { size: min, wrap: true, fits: false };
}
