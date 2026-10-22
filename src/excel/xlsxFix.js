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

// 名前付き範囲（オートフィルターの範囲・印刷範囲・名前を付けた範囲など）を、元のファイルのとおりに戻す
//  ExcelJS は読み書きの途中で名前付き範囲を崩す（シートの指定が消える・式や外部の参照が壊れる・一部が消える）。
//  Excel で開くと「修復」になるので、シートの並びが元と同じファイルに限り、workbook.xml の definedNames を元の文字のまま入れ直す
export async function restoreDefinedNames(outBuffer, origBuffer) {
  const [zo, zn] = await Promise.all([JSZip.loadAsync(origBuffer), JSZip.loadAsync(outBuffer)]);
  const wbO = await zo.file('xl/workbook.xml').async('string');
  const wbN = await zn.file('xl/workbook.xml').async('string');
  const sheetsOf = (xml) => [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]).join('\n');
  if (sheetsOf(wbO) !== sheetsOf(wbN)) throw new Error('シートの並びが元のファイルと違うため、名前付き範囲を戻せません');
  const block = (xml) => (xml.match(/<definedNames>[\s\S]*?<\/definedNames>|<definedNames\/>/) || [''])[0];
  const orig = block(wbO);
  let fixed = wbN.replace(/<definedNames>[\s\S]*?<\/definedNames>|<definedNames\/>/, '');
  // 元にあれば、元と同じ場所（シートの一覧の後ろ）に入れる
  //  （置き換えは関数で行う。名前の中の「$1」などを置き換えの記号として読ませないため）
  if (orig) fixed = fixed.replace('</sheets>', () => `</sheets>${orig}`);
  zn.file('xl/workbook.xml', fixed);
  return zn.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// workbook.xml の名前付き範囲の部分（照合用。なければ空の文字）
export async function definedNamesXml(buffer) {
  const z = await JSZip.loadAsync(buffer);
  const xml = await z.file('xl/workbook.xml').async('string');
  return (xml.match(/<definedNames>[\s\S]*?<\/definedNames>/) || [''])[0];
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
