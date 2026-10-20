// 簡易診断の特記事項に、寸法（腐朽・空洞・鋼棒など）の1行を数字から作るテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { appendNoteLine, measureKinds, measureLine, measureParts, measurePlaces, measurePrefill, measureRecord, measuresToInitial } from '../src/core/noteMeasures.js';

const cfg = structuredClone(cfgJson);

describe('寸法の1行', () => {
  it('部位・種類と数字から、決まった書き方の1行を作る', () => {
    expect(measureKinds(cfg).map((k) => k.label)).toEqual(['腐朽', '鋼棒貫入', '打診音異常', '枯れ枝']);
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

  it('部位を選ばない種類（枯れ枝）：種類ごとの1行の形。本数は木の入力から入れておく', () => {
    expect(measurePlaces('deadBranch', cfg)).toEqual([]);
    expect(measurePlaces('decay', cfg)).toEqual(cfg.noteMeasures.places);
    expect(measurePrefill('deadBranch', { deadBranchCount: '４' }, cfg)).toEqual({ count: '4' });
    expect(measurePrefill('decay', { deadBranchCount: '4' }, cfg)).toEqual({});
    expect(measureLine(cfg, 'deadBranch', '', { count: '6', height: { a: '5' }, branchDia: '4', branchLen: '3', max: true })).toBe('枯れ枝：6本、地上5m、枝直径4cm、枝長3m（最大）');
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
    expect(bad((m) => (m.kinds[3].prefill = { nothing: 'deadBranchCount' }))).toContain('prefill');
    expect(bad((m) => (m.kinds[3].places = '枝'))).toContain('places');
    expect(bad((m, c) => delete c.noteMeasures)).toBe('');
  });
});

describe('詳しい診断への引き継ぎ（initialSurvey.fromMeasures）', () => {
  // 見本の設定に、幹の腐朽（周囲長比あり）を足したもの
  const withTrunk = () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size', 'ratio', 'core'] });
    c.initialSurvey.fromMeasures.push({
      kind: 'decay',
      place: '幹',
      item: 't2',
      parts: { height: 'height', size: 'size', circ: { to: 'ratio', ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' } }, core: 'core' },
    });
    return c;
  };
  const tree = (measures) => ({ notes: measures.map((m) => `・${m.line}`).join('\n'), measures });
  const decay = (place, values) => {
    const c = withTrunk();
    return measureRecord('decay', place, values, measureLine(c, 'decay', place, values));
  };

  it('見本の設定は通る。形の誤りを知らせる', () => {
    expect(validateConfig(withTrunk()).errors).toEqual([]);
    const bad = (fn) => {
      const c = withTrunk();
      fn(c.initialSurvey.fromMeasures);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((l) => (l[1].kind = 'none'))).toContain('noteMeasures.kinds にありません');
    expect(bad((l) => (l[1].item = 'height'))).toContain('弱点（weak）の項目にありません');
    expect(bad((l) => (l[1].parts.size3 = 'size'))).toContain('「size3」は寸法「decay」の欄にありません');
    expect(bad((l) => (l[1].parts.height = 'branchDia'))).toContain('写し先「branchDia」');
    expect(bad((l) => (l[1].parts.circ.ratio.ge = '≧1/2'))).toContain('ratio');
  });

  it('寸法の数字を、弱点の詳細の数値と文に写す。110/150 は周囲長比（1/3 以上か）にする', () => {
    const c = withTrunk();
    const r = measuresToInitial(tree([decay('幹', { height: { a: '1.5' }, size: [{ w: '20', h: '50' }], circ: { a: '110', b: '150' }, core: true })]), c);
    expect(r.keys).toEqual(['t2Detail']);
    expect(r.values.t2DetailParts).toEqual({ height: { a: '1.5' }, size: [{ w: '20', h: '50' }], ratio: '≧1/3', core: true });
    expect(r.values.t2Detail).toBe('地上1.5m、20×50cm、周囲長比≧1/3（芯達）');
    // 1/3 ちょうどは「以上」、それ未満は「未満」
    expect(measuresToInitial(tree([decay('幹', { circ: { a: '50', b: '150' } })]), c).values.t2DetailParts.ratio).toBe('≧1/3');
    expect(measuresToInitial(tree([decay('幹', { circ: { a: '49', b: '150' } })]), c).values.t2DetailParts.ratio).toBe('＜1/3');
    // 設定にない部位（枝の腐朽）は写さない
    expect(measuresToInitial(tree([decay('枝', { height: { a: '3' } })]), c).keys).toEqual([]);
  });

  it('同じ項目に2つ来たら、大きさはつなげ、高さは低い所から高い所まで、比は大きい方', () => {
    const c = withTrunk();
    const r = measuresToInitial(
      tree([
        decay('幹', { height: { a: '2' }, size: [{ w: '10', h: '5' }], circ: { a: '20', b: '150' } }),
        decay('幹', { height: { a: '0.5', b: '1' }, size: [{ w: '7', h: '7' }], circ: { a: '60', b: '150' } }),
      ]),
      c,
    );
    expect(r.values.t2DetailParts).toEqual({ height: { a: '0.5', b: '2' }, size: [{ w: '10', h: '5' }, { w: '7', h: '7' }], ratio: '≧1/3' });
  });

  it('特記事項から消した・書き換えた1行の数字は使わない', () => {
    const c = withTrunk();
    const m = decay('幹', { height: { a: '2' } });
    expect(measuresToInitial({ notes: '・枝の偏り', measures: [m] }, c).keys).toEqual([]);
    expect(measuresToInitial({ notes: `・${m.line.replace('2m', '3m')}`, measures: [m] }, c).keys).toEqual([]);
    expect(measuresToInitial({ notes: `・${m.line}`, measures: [m] }, c).keys).toEqual(['t2Detail']);
  });

  it('枯れ枝（部位なし）は枯れ枝の項目へ。設定がなければ何もしない', () => {
    const v = { count: '3', height: { a: '4' }, branchDia: '5', branchLen: '1.5', max: true };
    const m = measureRecord('deadBranch', '', v, measureLine(cfg, 'deadBranch', '', v));
    const r = measuresToInitial(tree([m]), cfg);
    expect(r.values.b4DetailParts).toEqual({ count: '3', height: { a: '4' }, branchDia: '5', branchLen: '1.5' }); // 写し先にない「最大」は写さない
    expect(r.values.b4Detail).toBe('3本、地上4m、枝直径5cm、枝長1.5m');
    const c = structuredClone(cfgJson);
    delete c.initialSurvey.fromMeasures;
    expect(measuresToInitial(tree([m]), c)).toEqual({ values: {}, keys: [] });
  });
});
