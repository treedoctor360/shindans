// 文が枠に収まるかの見積もりのテスト
import { describe, expect, it } from 'vitest';
import { fitSize, isProportional, linesNeeded, sheetGeometry } from '../src/excel/fitText.js';

describe('文の大きさの見積もり', () => {
  it('列の幅・行の高さ・結合から枠の大きさを出す', () => {
    const xml =
      '<worksheet><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="10"/><col min="2" max="3" width="5"/></cols>' +
      '<sheetData><row r="2" ht="30"/></sheetData><mergeCells><mergeCell ref="B1:C2"/></mergeCells></worksheet>';
    const box = sheetGeometry(xml);
    expect(box('A1')).toEqual({ width: Math.trunc(10 * 7 + 5) * 0.75, height: 15 });
    expect(box('B1')).toEqual({ width: 2 * Math.trunc(5 * 7 + 5) * 0.75, height: 45 });
  });

  it('全角は文字の大きさ、半角はその6割で見積もり、折り返した行の数を出す', () => {
    expect(linesNeeded('あいう', 10, 34)).toBe(1); // 30pt
    expect(linesNeeded('あいうえ', 10, 34)).toBe(2);
    expect(linesNeeded('a\nb', 10, 100)).toBe(2);
  });

  it('1行に収まれば変えない。収まらなければ折り返して入る一番大きい大きさ。最小でも入らなければ fits: false', () => {
    expect(fitSize('短い', { width: 100, height: 15 }, 11)).toEqual({ size: 11, wrap: false, fits: true });
    const r = fitSize('あ'.repeat(20), { width: 100, height: 30 }, 11);
    expect(r.wrap).toBe(true);
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThan(11);
    expect(fitSize('あ'.repeat(200), { width: 100, height: 15 }, 11)).toEqual({ size: 7, wrap: true, fits: false });
  });
});

describe('フォントによる見積もりの違い', () => {
  it('ＭＳ Ｐゴシックなど文字ごとに幅が変わるフォントは、半角を小さめに見積もる（等幅・知らないフォントは大きめのまま）', () => {
    expect(isProportional('ＭＳ Ｐゴシック')).toBe(true);
    expect(isProportional('ＭＳ ゴシック')).toBe(false);
    expect(isProportional('知らないフォント')).toBe(false);
    expect(isProportional('')).toBe(false);
    const text = '30/80 地上0～0.5m、30cm×50cm 1234567890';
    expect([linesNeeded(text, 8, 175, true), linesNeeded(text, 8, 175, false)]).toEqual([1, 2]);
    // 等幅の見積もりでは小さくするが、Ｐゴシックなら元の大きさのまま収まる
    const box = { width: 175, height: 20 };
    expect(fitSize(text, box, 8, 7, false)).toEqual({ size: 7.5, wrap: true, fits: true });
    expect(fitSize(text, box, 8, 7, true)).toEqual({ size: 8, wrap: false, fits: true });
  });
});
