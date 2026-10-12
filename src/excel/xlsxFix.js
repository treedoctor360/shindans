// ExcelJS が書き出したファイルの補正（ExcelJS の既知の落とし穴への対策）
//  xlsx ファイルの中身は、XML ファイルを ZIP でまとめたもの。JSZip で開いて XML を直接直す。

import JSZip from 'jszip';

// 罫線の色「自動」は ExcelJS が書き出さず、Excel で線が消える。色のない罫線に「自動」を付け直す
export function fixBorderXml(stylesXml) {
  return stylesXml.replace(/<(left|right|top|bottom|diagonal) style="([A-Za-z]+)"\/>/g, '<$1 style="$2"><color auto="1"/></$1>');
}

// 書き出し後の補正をまとめて行う
export async function finishXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('xl/styles.xml');
  if (f) zip.file('xl/styles.xml', fixBorderXml(await f.async('string')));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// シートの並び順どおりに、中のファイル名（xl/worksheets/sheetN.xml）を返す
//  並び順と N は一致しないことがあるので、workbook.xml とその関連付け（rels）から対応を取る
export async function sheetFiles(zip) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const targets = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const tg = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && tg) targets[id] = tg.replace(/^\/?(xl\/)?/, 'xl/');
  }
  return [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = (m[0].match(/\bname="([^"]+)"/) || [])[1];
    const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    return { name, file: targets[rid] };
  });
}
