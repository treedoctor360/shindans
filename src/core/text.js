// 文字の整形に使う小さな道具（画面・Excel に依存しない）

// 全角の英数字・カッコ・ピリオド・カンマ・空白を半角にする
export const toHalf = (s) =>
  String(s ?? '').replace(/[Ａ-Ｚａ-ｚ０-９（）．，　]/g, (c) =>
    c === '　' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

// 正の数として読めれば数値、読めなければ null（0・空欄・文字は null）
export const num = (v) => {
  const n = parseFloat(toHalf(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 「{名前}」の部分を vars の値で置き換える（設定ファイルの文の穴埋め）
export const fill = (template, vars = {}) =>
  String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// 日付 "2099-04-05" → "4/5"
export const monthDay = (ymd) => {
  const [, m, d] = String(ymd || '').split('-');
  return m ? `${+m}/${+d}` : '';
};
