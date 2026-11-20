// Excel の式を画面のために計算する（カルテの判定の欄など）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { evaluate, resultText, sheetCalc } from '../src/excel/formula.js';

const cells = (o) => (a) => (a in o ? o[a] : null);

describe('式の計算', () => {
  it('選んだ選択肢から判定の文字を出す（入れ子の IF・文字を比べる）', () => {
    const f = '=IF(K33="□無 ■有（周囲＜1/3）","B",IF(K33="□無 ■有（周囲≧1/3）","C",IF(K33="□無 ■有（芯到達・周囲＜1/3）","D",IF(K33="□無 ■有（芯到達・周囲≧1/3）","E",""))))';
    expect(evaluate(f, cells({ K33: '□無 ■有（周囲＜1/3）' }))).toBe('B');
    expect(evaluate(f, cells({ K33: '□無 ■有（芯到達・周囲≧1/3）' }))).toBe('E');
    expect(evaluate(f, cells({ K33: '■無 □有' }))).toBe('');
    expect(evaluate('IF(K23="□無 ■有","E"," ")', cells({ K23: '■無 □有' }))).toBe(' ');
  });
  it('数の計算・IFERROR・ROUND（0 から遠い方へ）・AND', () => {
    expect(evaluate('IFERROR(ROUND(K7/(K8/3.14),0),0)', cells({ K7: 16, K8: 1.82 }))).toBe(28);
    expect(evaluate('IFERROR(ROUND(K7/(K8/3.14),0),0)', cells({ K7: 16 }))).toBe(0); // 幹周が空 → 0 で割る → 0
    expect(evaluate('ROUND(2.675,2)', cells({}))).toBe(2.68);
    expect(evaluate('ROUND(-2.5,0)', cells({}))).toBe(-3);
    const g = 'IF(U65="","",IF(U65<1,"A",IF(AND(U65>=1,U65<20),"B",IF(AND(U65>=20,U65<40),"C","D"))))';
    expect(evaluate(g, cells({}))).toBe('');
    expect(evaluate(g, cells({ U65: 0.5 }))).toBe('A');
    expect(evaluate(g, cells({ U65: 25 }))).toBe('C');
    expect(evaluate('IF(K12>=50,"50倍以上","")', cells({ K12: 50 }))).toBe('50倍以上');
  });
  it('Excel と同じ比べ方・つなぎ方', () => {
    expect(evaluate('"abc"="ABC"', cells({}))).toBe(true); // 大文字・小文字を区別しない
    expect(evaluate('1<"a"', cells({}))).toBe(true); // 数 < 文字
    expect(evaluate('A1=""', cells({}))).toBe(true); // 空のセル
    expect(evaluate('A1=0', cells({}))).toBe(true);
    expect(evaluate('"a""b"&1&TRUE', cells({}))).toBe('a"b1TRUE');
    expect(evaluate('-2^2+$B$1*2', cells({ B1: 3 }))).toBe(10);
    expect(evaluate('"x"+1', cells({}))).toEqual({ error: '#VALUE!' });
  });
  it('計算しない形の式は投げる（呼ぶ側で保存されている結果を使う）', () => {
    expect(() => evaluate('SUM(A1:A3)', cells({}))).toThrow();
    expect(() => evaluate('Sheet2!A1', cells({}))).toThrow();
    expect(() => evaluate('VLOOKUP(A1,B1,2)', cells({}))).toThrow();
  });
});

describe('シートの式', () => {
  it('入っている値から計算し直す。式のセルを見ている式も計算する。計算できない式は undefined', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.getCell('A1').value = 16;
    ws.getCell('A2').value = 1.82;
    ws.getCell('A3').value = { formula: 'IFERROR(ROUND(A1/(A2/3.14),0),0)', result: 0 }; // 保存されている結果は古い
    ws.getCell('A4').value = { formula: 'IF(A3>=50,"50倍以上","")', result: 'x' };
    ws.getCell('B1').value = '□無 ■有（大）';
    ws.getCell('B2').value = { formula: 'IF(B1="□無 ■有（小）","D",IF(B1="□無 ■有（大）","E",""))', result: '' };
    ws.getCell('B3').value = { formula: 'SUM(A1:A2)', result: 17.82 };
    ws.getCell('C1').value = { formula: 'C2+1', result: 1 };
    ws.getCell('C2').value = { formula: 'C1+1', result: 2 }; // 巡っている
    const calc = sheetCalc(ws);
    expect(calc.resultOf(ws.getCell('A3'))).toBe(28);
    expect(calc.resultOf(ws.getCell('A4'))).toBe('');
    expect(calc.resultOf(ws.getCell('B2'))).toBe('E');
    expect(calc.resultOf(ws.getCell('B3'))).toBeUndefined();
    expect(calc.resultOf(ws.getCell('C1'))).toBeUndefined();
    expect(calc.resultOf(ws.getCell('A1'))).toBeUndefined(); // 式でないセル
    expect(resultText(true)).toBe('TRUE');
    expect(resultText({ error: '#DIV/0!' })).toBe('#DIV/0!');
  });
});
