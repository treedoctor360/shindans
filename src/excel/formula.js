// Excel の式を、画面に出すために計算する（見るだけ。カルテを画面で確かめるとき）
//
//  確認用カルテの様式には、選んだ選択肢などから文字を出す式が入っている（例 =IF(K23="□無 ■有","E","")）。
//  ダウンロードしたファイルは Excel が開くときに計算し直すが、画面に出すときは保存されている計算の結果しかない。
//  そこで、よく使う形の式だけをここで計算する。
//
//  計算できるもの：数・文字・TRUE/FALSE・同じシートのセル（A1・$A$1）・( )、
//    比べる（= <> < > <= >=）・文字をつなぐ（&）・足す引く掛ける割る（+ - * /）・べき乗（^）・符号（-）、
//    関数 IF・AND・OR・NOT・IFERROR・ROUND
//  それ以外（範囲・別のシート・ほかの関数など）は計算せず、呼ぶ側で保存されている結果を使う（Unsupported を投げる）

export class Unsupported extends Error {}

const err = (code) => ({ error: code });
const isErr = (v) => v != null && typeof v === 'object' && 'error' in v;

// ---------- 式を読む（字句に分ける → 木の形にする） ----------

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      // 文字。「""」は「"」1文字
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Unsupported('文字の終わりがありません');
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    const num = src.slice(i).match(/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const op = src.slice(i).match(/^(<>|<=|>=|[=<>&+\-*/^(),])/);
    if (op) {
      out.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    const word = src.slice(i).match(/^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/);
    if (word) {
      const w = word[0];
      i += w.length;
      if (src[i] === ':' || src[i] === '!') throw new Unsupported('範囲・別のシートは計算しません');
      const ref = w.match(/^\$?([A-Za-z]{1,3})\$?(\d+)$/);
      if (ref) out.push({ t: 'ref', v: `${ref[1].toUpperCase()}${ref[2]}` });
      else out.push({ t: 'name', v: w.toUpperCase() });
      continue;
    }
    throw new Unsupported(`読めない文字：${ch}`);
  }
  return out;
}

// 優先順位（低い順）：比べる → & → + - → * / → ^ → 符号（Excel と同じ）
function parse(src) {
  const tk = tokenize(String(src).replace(/^=/, ''));
  let p = 0;
  const peek = () => tk[p];
  const isOp = (...vs) => peek()?.t === 'op' && vs.includes(peek().v);
  const take = () => tk[p++];
  const expect = (v) => {
    if (!isOp(v)) throw new Unsupported(`「${v}」がありません`);
    p++;
  };
  const binary = (next, ops) => () => {
    let left = next();
    while (isOp(...ops)) {
      const op = take().v;
      left = { t: 'bin', op, a: left, b: next() };
    }
    return left;
  };
  let compare;
  const primary = () => {
    const x = take();
    if (!x) throw new Unsupported('式が途中で終わっています');
    if (x.t === 'num' || x.t === 'str') return { t: 'lit', v: x.v };
    if (x.t === 'ref') return { t: 'ref', v: x.v };
    if (x.t === 'op' && x.v === '(') {
      const e = compare();
      expect(')');
      return e;
    }
    if (x.t === 'name') {
      if (!isOp('(')) {
        if (x.v === 'TRUE') return { t: 'lit', v: true };
        if (x.v === 'FALSE') return { t: 'lit', v: false };
        throw new Unsupported(`名前は計算しません：${x.v}`);
      }
      p++;
      const args = [];
      if (!isOp(')')) {
        for (;;) {
          // 省略した引数（例 IF(A1,,1)）
          args.push(isOp(',', ')') ? { t: 'lit', v: null } : compare());
          if (isOp(',')) {
            p++;
            continue;
          }
          break;
        }
      }
      expect(')');
      return { t: 'fn', name: x.v, args };
    }
    throw new Unsupported('式が読めません');
  };
  // 符号は ^ より先に付く（Excel では -2^2 は 4）
  const unary = () => {
    if (isOp('-', '+')) {
      const sign = take().v;
      return { t: 'neg', sign, a: unary() };
    }
    return primary();
  };
  const power = binary(unary, ['^']);
  const mul = binary(power, ['*', '/']);
  const add = binary(mul, ['+', '-']);
  const concat = binary(add, ['&']);
  compare = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const tree = compare();
  if (p !== tk.length) throw new Unsupported('式の終わりが読めません');
  return tree;
}

// ---------- 値の読み替え（Excel と同じ決まり） ----------

function toNumber(v) {
  if (isErr(v)) return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).trim());
  return String(v).trim() !== '' && Number.isFinite(n) ? n : err('#VALUE!');
}
function toBool(v) {
  if (isErr(v)) return v;
  if (v == null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return err('#VALUE!');
}
const toText = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

// 比べる。Excel では 数 < 文字 < TRUE/FALSE の順。文字は大文字・小文字を区別しない。空のセルは相手の種類に合わせる
function cmp(a, b) {
  const kind = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1);
  if (a == null) a = typeof b === 'number' ? 0 : typeof b === 'boolean' ? false : '';
  if (b == null) b = typeof a === 'number' ? 0 : typeof a === 'boolean' ? false : '';
  const ka = kind(a);
  const kb = kind(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (ka === 1) {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// 四捨五入（0 から遠い方へ。小数の誤差で 2.675 が 2.67 にならないよう 15 桁で丸めてから）
function round(x, n) {
  const f = 10 ** n;
  const y = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.round(y)) / f;
}

// ---------- 計算する ----------

// 式を計算する。cellValue(番地) でセルの値（数・文字・TRUE/FALSE・null（空）・{ error }）を返す
export function evaluate(formula, cellValue) {
  const run = (n) => {
    switch (n.t) {
      case 'lit':
        return n.v;
      case 'ref':
        return cellValue(n.v);
      case 'neg': {
        const v = toNumber(run(n.a));
        return isErr(v) ? v : n.sign === '-' ? -v : v;
      }
      case 'bin': {
        const a = run(n.a);
        if (isErr(a)) return a;
        const b = run(n.b);
        if (isErr(b)) return b;
        if (n.op === '&') return toText(a) + toText(b);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const c = cmp(a, b);
          return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[n.op];
        }
        const x = toNumber(a);
        if (isErr(x)) return x;
        const y = toNumber(b);
        if (isErr(y)) return y;
        if (n.op === '+') return x + y;
        if (n.op === '-') return x - y;
        if (n.op === '*') return x * y;
        if (n.op === '/') return y === 0 ? err('#DIV/0!') : x / y;
        if (n.op === '^') return x ** y;
        throw new Unsupported(n.op);
      }
      case 'fn':
        return call(n.name, n.args);
      default:
        throw new Unsupported('式が読めません');
    }
  };
  const call = (name, args) => {
    if (name === 'IF') {
      if (args.length < 1 || args.length > 3) throw new Unsupported('IF の引数');
      const c = toBool(run(args[0]));
      if (isErr(c)) return c;
      if (c) return args.length > 1 ? (run(args[1]) ?? 0) : true;
      return args.length > 2 ? (run(args[2]) ?? 0) : false;
    }
    if (name === 'IFERROR') {
      if (args.length !== 2) throw new Unsupported('IFERROR の引数');
      const v = run(args[0]);
      return isErr(v) ? (run(args[1]) ?? 0) : v;
    }
    if (name === 'AND' || name === 'OR') {
      if (!args.length) throw new Unsupported(`${name} の引数`);
      const vs = args.map((a) => toBool(run(a)));
      const e = vs.find(isErr);
      if (e) return e;
      return name === 'AND' ? vs.every(Boolean) : vs.some(Boolean);
    }
    if (name === 'NOT') {
      if (args.length !== 1) throw new Unsupported('NOT の引数');
      const v = toBool(run(args[0]));
      return isErr(v) ? v : !v;
    }
    if (name === 'ROUND') {
      if (args.length !== 2) throw new Unsupported('ROUND の引数');
      const x = toNumber(run(args[0]));
      if (isErr(x)) return x;
      const d = toNumber(run(args[1]));
      if (isErr(d)) return d;
      return round(x, Math.trunc(d));
    }
    throw new Unsupported(`この関数は計算しません：${name}`);
  };
  return run(parse(formula));
}

// ---------- シート（ExcelJS）の式を計算する ----------

// ExcelJS のセルの値 → 計算に使う値。式なら formulaOf で式を返す
const formulaOf = (cell) => {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (typeof v.formula === 'string') return v.formula;
    if (v.sharedFormula && typeof cell.formula === 'string') return cell.formula;
  }
  return null;
};
function plainValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) throw new Unsupported('日付は計算しません');
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  if ('error' in v) return { error: v.error };
  if ('result' in v) {
    if (v.result instanceof Date) throw new Unsupported('日付は計算しません');
    return v.result ?? null;
  }
  if ('text' in v) return String(v.text);
  throw new Unsupported('読めない値');
}

// シートの式の計算の道具。resultOf(セル) で、計算した結果（計算できなければ undefined）を返す
//  式が別の式のセルを見ているときは、そのセルも計算する（同じセルは1回だけ。巡っていれば計算しない）
export function sheetCalc(ws) {
  const memo = new Map();
  const doing = new Set();
  const valueAt = (addr) => {
    const cell = ws.getCell(addr);
    // 結合の中の左上以外のセルは空（Excel と同じ）
    if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
    if (formulaOf(cell)) {
      const r = resultAt(addr);
      if (r === undefined) throw new Unsupported('見ているセルの式が計算できません');
      return r;
    }
    return plainValue(cell.value);
  };
  const resultAt = (addr) => {
    if (memo.has(addr)) return memo.get(addr);
    if (doing.has(addr)) return undefined; // 巡っている
    doing.add(addr);
    let r;
    try {
      r = evaluate(formulaOf(ws.getCell(addr)), valueAt);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      r = undefined;
    } finally {
      doing.delete(addr);
    }
    memo.set(addr, r);
    return r;
  };
  return {
    // セルが式なら計算した結果（計算できなければ undefined）。式でなければ undefined
    resultOf(cell) {
      return formulaOf(cell) ? resultAt(cell.address) : undefined;
    },
  };
}

// 計算した結果 → 画面に出す文字
export const resultText = (v) => (v == null ? '' : isErr(v) ? v.error : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
