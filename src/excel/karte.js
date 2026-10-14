// 前回の診断カルテ（Excel）を読む
//
// カルテは「1本1シート」の様式を想定する。どの文字の横に何があるかは設定 previous.karte に書く（様式の言葉をコードに書かない）。
//  fields   … 「見出しの文字」の右にある値（nth：右に何番目か）。例：樹木番号の右 → 番号
//  yesMark  … 弱点が「有」のときの印（例：「■有」）。この印を含むセルがある行を、弱点の行とする
//  parts    … 部位の見出し（弱点の番号は部位ごとに①から始まるので、部位と組で持つ）
//  summary  … 評価の欄（見出しの文字と、そこから何行分を読むか）
//  photoCaptions … 写真の見出し（写真がどの見出しの下にあるかで、写真の名前にする）
//
// 結合セルは左上のセルだけを読む（同じ文字を何度も拾わないように）。

import ExcelJS from 'exceljs';
import { toHalf } from '../core/text.js';

// セルの中身を文字にする
function textOf(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    const d = v;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('result' in v) return textOf(v.result);
    if (v.text != null) return String(v.text);
    return '';
  }
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000); // 計算結果の細かい端数は丸める
  return String(v);
}

// 1行の、文字のあるセル（結合セルは左上だけ）
function rowCells(ws, r) {
  const out = [];
  const row = ws.getRow(r);
  for (let c = 1; c <= ws.columnCount; c++) {
    const cell = row.getCell(c);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const t = textOf(cell.value).replace(/\s+/g, ' ').trim();
    if (t) out.push({ c, t });
  }
  return out;
}

// 見出しの右 nth 番目の値
function valueRight(cells, label, nth = 1) {
  const i = cells.findIndex((x) => x.t === label);
  return i >= 0 ? cells[i + nth]?.t || '' : null;
}

// 1シート（1本）を読む。カルテでなければ null
export function readKarteSheet(ws, wb, spec) {
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) rows.push({ r, cells: rowCells(ws, r) });

  // 見出しの右の値
  const f = {};
  for (const [key, def] of Object.entries(spec.fields || {})) {
    const labels = Array.isArray(def.label) ? def.label : [def.label];
    for (const { cells } of rows) {
      for (const label of labels) {
        const v = valueRight(cells, label, def.nth || 1);
        if (v != null && f[key] == null) f[key] = v;
      }
    }
  }
  if (!f.treeNo) return null;

  // 弱点（「有」の行だけ）
  const items = [];
  let part = '';
  for (const { cells } of rows) {
    const p = cells.find((x) => (spec.parts || []).includes(x.t));
    if (p) part = p.t;
    const mi = cells.findIndex((x) => x.t.includes(spec.yesMark));
    if (mi < 1) continue;
    const open = cells.findIndex((x, i) => i > mi && x.t === '[');
    const close = cells.findIndex((x, i) => i > mi && x.t === ']');
    const grade = open >= 0 && close > open ? cells.slice(open + 1, close).map((x) => x.t).join('') : '';
    const after = close >= 0 ? cells[close + 1]?.t || '' : '';
    // 「□無 ■有（大）」→「有（大）」
    const mark = cells[mi].t;
    const result = mark.slice(mark.indexOf(spec.yesMark) + 1).trim();
    items.push({ part, item: cells[mi - 1].t, result, grade, detail: (spec.photoCaptions || []).includes(after) ? '' : after });
  }

  // 評価の欄：見出しの行から rows 行分の文字を、見出しを除いてつなぐ
  const summary = [];
  for (const s of spec.summary || []) {
    const at = rows.findIndex(({ cells }) => cells.some((x) => x.t === s.label));
    if (at < 0) continue;
    const lines = rows
      .slice(at, at + (s.rows || 1))
      .map(({ cells }) => cells.filter((x) => x.t !== s.label && !(spec.photoCaptions || []).includes(x.t)).map((x) => x.t).join(' '))
      .filter(Boolean);
    if (lines.length) summary.push({ label: s.label, lines });
  }

  // 写真：見出しの下にあるもの。位置の上から順
  const captionRows = rows.flatMap(({ r, cells }) => cells.filter((x) => (spec.photoCaptions || []).includes(x.t)).map((x) => ({ r, t: x.t })));
  const photos = ws
    .getImages()
    .map((im) => {
      const top = Math.floor(im.range?.tl?.nativeRow ?? im.range?.tl?.row ?? 0) + 1; // 1から数えた行
      const cap = captionRows.filter((x) => x.r <= top + 1).pop();
      const media = wb.getImage(Number(im.imageId));
      if (!media?.buffer) return null;
      return { caption: cap?.t || '写真', top, type: `image/${media.extension === 'jpg' ? 'jpeg' : media.extension}`, buffer: media.buffer };
    })
    .filter(Boolean)
    .sort((a, b) => a.top - b.top);

  return {
    treeNo: toHalf(f.treeNo).trim().toUpperCase(),
    code: toHalf(f.code || '').trim(),
    placeName: f.placeName || '',
    species: f.species || '',
    date: f.date || '',
    inspector: f.inspector || '',
    items,
    summary,
    photos,
  };
}

// カルテのファイル1つを読む。返す形：{ trees: [...], skipped: [カルテでなかったシート名] }
export async function readKarteBook(buffer, cfg, fileName = '') {
  const spec = cfg.previous?.karte;
  if (!spec) throw new Error('設定ファイルに前回のカルテの読み方（previous.karte）がありません');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const trees = [];
  const skipped = [];
  for (const ws of wb.worksheets) {
    const t = readKarteSheet(ws, wb, spec);
    if (t) trees.push({ ...t, file: fileName, sheet: ws.name });
    else skipped.push(`${fileName} ${ws.name}`.trim());
  }
  return { trees, skipped };
}
