// 簡易診断の特記事項に、寸法（腐朽・空洞・鋼棒など）の1行を数字から作るテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { appendNoteLine, measureKinds, measureLine, measureParts } from '../src/core/noteMeasures.js';

const cfg = structuredClone(cfgJson);

describe('寸法の1行', () => {
  it('部位・種類と数字から、決まった書き方の1行を作る', () => {
    expect(measureKinds(cfg).map((k) => k.label)).toEqual(['腐朽', '鋼棒貫入', '打診音異常']);
    expect(measureParts('decay', cfg).map((p) => p.name)).toEqual(['height', 'size', 'circ', 'core']);
    expect(measureLine(cfg, 'decay', '幹', { height: { a: '２' }, size: [{ w: '20', h: '50' }], circ: { a: '110', b: '150' }, core: true })).toBe(
      '幹の腐朽：地上2m、20cm×50cm、110/150（芯達）',
    );
    expect(measureLine(cfg, 'rod', '根株', { rod: { a: '29', b: '50' } })).toBe('根株の鋼棒貫入：29cm/50cm');
    expect(measureLine(cfg, 'tap', '幹', { height: { a: '0.5', b: '2.2' } })).toBe('幹の打診音異常：地上0.5～2.2m');
    // 2か所
    expect(measureLine(cfg, 'decay', '枝', { size: [{ w: '10', h: '5' }, { w: '7', h: '7' }] })).toBe('枝の腐朽：10cm×5cm、7cm×7cm（2箇所）');
    // 数字が何もなければ作らない。部位・種類が選ばれていなければ作らない
    expect(measureLine(cfg, 'decay', '幹', {})).toBe('');
    expect(measureLine(cfg, 'decay', '', { height: { a: '2' } })).toBe('');
    expect(measureLine(cfg, 'nothing', '幹', { height: { a: '2' } })).toBe('');
  });

  it('特記事項の最後に「・」を付けて1行足す（空なら1行目に）', () => {
    expect(appendNoteLine('', 'A')).toBe('・A');
    expect(appendNoteLine('・枝の偏り', 'A')).toBe('・枝の偏り\n・A');
    expect(appendNoteLine('・枝の偏り\n\n', 'A')).toBe('・枝の偏り\n・A');
  });
});

describe('設定の確かめ', () => {
  it('寸法の設定の誤りを知らせる。省略してもよい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (fn) => {
      const c = structuredClone(cfgJson);
      fn(c.noteMeasures, c);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((m) => (m.kinds[0].parts = ['nothing']))).toContain('noteMeasures.kinds[0].parts');
    expect(bad((m) => (m.places = []))).toContain('noteMeasures.places');
    expect(bad((m) => (m.parts.circ.type = 'slider'))).toContain('noteMeasures.parts.circ');
    expect(bad((m, c) => delete c.noteMeasures)).toBe('');
  });
});
