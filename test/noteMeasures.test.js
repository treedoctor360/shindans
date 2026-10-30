// 簡易診断の特記事項に、寸法（腐朽・空洞・鋼棒など）の1行を数字から作るテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { autoDbNote, dbNoteOf } from '../src/core/notes.js';
import { photoPlan } from '../src/core/photo.js';
import { addMeasure, appendNoteLine, measureKinds, measureLine, measureParts, measurePlaces, measurePrefill, measureRecord, measuresToInitial } from '../src/core/noteMeasures.js';

const cfg = structuredClone(cfgJson);

describe('寸法の1行', () => {
  it('部位・種類と数字から、決まった書き方の1行を作る', () => {
    expect(measureKinds(cfg).map((k) => k.label)).toEqual(['腐朽', '鋼棒貫入', '打診音異常', '枯れ枝', 'はみ出し']);
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

describe('決まった値を入れる（fromMeasures の set）', () => {
  it('根株の空洞を、幹の空洞の欄に「根株、…」として写す', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.site = { type: 'choice', label: '部位', options: ['根株'] };
    c.initialSurvey.detailParts.size3 = { type: 'size', label: '縦×横×奥行', depth: true, unitEach: true };
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't1', label: '開口空洞', type: 'weak', parts: ['site', 'height', 'size3'] });
    c.noteMeasures.kinds.push({ key: 'cavity', label: '開口空洞', parts: ['height', 'size3'] });
    c.initialSurvey.fromMeasures.push({ kind: 'cavity', place: '根株', item: 't1', set: { site: '根株' }, parts: { size3: 'size3' } });
    expect(validateConfig(c).errors).toEqual([]);
    const v = { size3: [{ w: '15', h: '11', d: '5' }] };
    const line = measureLine(c, 'cavity', '根株', v);
    const r = measuresToInitial({ notes: `・${line}`, measures: [measureRecord('cavity', '根株', v, line)] }, c);
    expect(r.values.t1DetailParts).toEqual({ site: '根株', size3: [{ w: '15', h: '11', d: '5' }] });
    expect(r.values.t1Detail).toBe('根株、15cm×11cm×5cm');

    const bad = (fn) => {
      const x = structuredClone(c);
      fn(x.initialSurvey.fromMeasures.at(-1));
      return validateConfig(x).errors.join('\n');
    };
    expect(bad((m) => (m.set = { site: '根元' }))).toContain('選択肢にありません');
    expect(bad((m) => (m.set = { nothing: 'x' }))).toContain('数値にありません');
  });
});

describe('特記事項の寸法の1行から撮る写真を決める（kinds の photo / fullOnly）', () => {
  const c = structuredClone(cfgJson);
  c.noteMeasures.kinds.find((k) => k.key === 'decay').photo = '{place}の腐朽';
  c.noteMeasures.kinds.find((k) => k.key === 'rod').fullOnly = true;
  const base = { vigor: '並', lean: '無', deadBranch: '無', decay: '無', fungus: '無', initialNeeded: '否', grade: 'B' };
  const tree = (measures, notes) => ({ ...base, measures, notes });
  const decay = measureRecord('decay', '幹', {}, '幹の腐朽：10×20cm');
  const rod = measureRecord('rod', '根株', {}, '根株の鋼棒貫入：2cm');

  it('設定は正しい（photo・fullOnly を足しても通る）', () => expect(validateConfig(c)).toEqual({ ok: true, errors: [] }));

  it('photo の種類の1行があれば、その弱点写真が要る', () => {
    const p = photoPlan(tree([decay], `・${decay.line}`), c);
    expect(p.mode).toBe('full+weak');
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
  });

  it('fullOnly の種類の1行だけなら、全景だけ要る', () => {
    expect(photoPlan(tree([rod], `・${rod.line}`), c).mode).toBe('fullOnly');
  });

  it('特記事項から消した・書き換えた1行は判定に使わない。設定にない種類は今までどおり', () => {
    expect(photoPlan(tree([decay, rod], '・別の特記'), c).mode).toBe('none');
    expect(photoPlan(tree([decay], `・${decay.line}`), cfgJson).mode).toBe('none');
  });

  // 特記事項に書いたものは撮る（現場で撮る写真。一覧表の写真の有無・弱点写真の上限には数えない）
  it('特記事項の寸法の1行・定型文・手で書いた行は、すべて撮る写真（extra）に出る', () => {
    const p = photoPlan(tree([rod], `・${rod.line}\n・枝の偏り\n・幹に古い傷あり。`), c);
    expect(p.mode).toBe('fullOnly'); // 判定（写真の有無）は今までどおり
    expect(p.extra.map((x) => x.name)).toEqual(['枝の偏り', '根株の鋼棒貫入', '幹に古い傷あり']);
    expect(p.extra.every((x) => x.orient === c.photo.weakOrient)).toBe(true);
    expect(p.shoot.map((x) => x.name)).toEqual(['全景', '枝の偏り', '根株の鋼棒貫入', '幹に古い傷あり']);
  });

  it('【再現】手で直した寸法の1行は「：」の前だけを名前にし、弱点写真・寸法の1行と同じ名前なら二重に出さない', () => {
    const p = photoPlan(tree([decay], `・${decay.line}\n・幹の腐朽：地上1m、10cm×5cm\n・根株の腐朽：地上0～0.2m、25cm×20cm`), c);
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
    expect(p.extra.map((x) => x.name)).toEqual(['根株の腐朽']);
  });

  it('弱点写真と同じ名前は二重に出さない。弱点がなくても特記があれば全景も撮る', () => {
    const p = photoPlan(tree([decay], `・${decay.line}`), c);
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
    expect(p.extra).toEqual([]);
    const q = photoPlan(tree([], '・枝の偏り'), cfgJson);
    expect(q.mode).toBe('none');
    expect(q.shoot.map((x) => x.name)).toEqual(['全景', '枝の偏り']);
    expect(photoPlan(tree([], ''), cfgJson).shoot).toEqual([]);
  });
});

describe('同じ部位・種類の寸法を1行にまとめる（noteMeasures.merge）', () => {
  const c = structuredClone(cfgJson);
  c.noteMeasures.merge = true;
  c.noteMeasures.parts.height.prefix = 'H';
  c.noteMeasures.parts.size.unitEach = false;
  c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size'] });
  c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '根株', item: 't2', parts: { height: 'height', size: 'size' } });
  const rec = (place, values) => measureRecord('decay', place, values, measureLine(c, 'decay', place, values));
  const add = (tree, r) => ({ ...tree, ...addMeasure(tree, c, r) });

  it('設定は通る', () => expect(validateConfig(c).errors).toEqual([]));

  it('2つ目からは、同じ部位・種類の1行に①②…でまとめる。ほかの行・別の部位はそのまま', () => {
    let t = { notes: '・ガードリング(不可)', measures: [] };
    t = add(t, rec('根株', { height: { a: '0', b: '0.4' }, size: [{ w: '40', h: '20' }] }));
    expect(t.notes).toBe('・ガードリング(不可)\n・根株の腐朽：H0～0.4m、40×20cm');
    t = add(t, rec('幹', { size: [{ w: '10', h: '5' }] }));
    t = add(t, rec('根株', { height: { a: '0', b: '0.5' }, size: [{ w: '50', h: '10' }] }));
    t = add(t, rec('根株', { height: { a: '0', b: '0.3' }, size: [{ w: '30', h: '30' }] }));
    expect(t.notes).toBe('・ガードリング(不可)\n・根株の腐朽：①H0～0.4m、40×20cm ②H0～0.5m、50×10cm ③H0～0.3m、30×30cm\n・幹の腐朽：10×5cm');
    // まとめた寸法は、どれも特記事項に残っている扱い → 詳しい診断に全部写す（大きさは並べ、高さは一番低い所から高い所まで）
    expect(t.measures.filter((m) => m.place === '根株').every((m) => t.notes.includes(m.line))).toBe(true);
    const r = measuresToInitial(t, c);
    expect(r.values.t2DetailParts.size).toHaveLength(3);
    expect(r.values.t2DetailParts.height).toEqual({ a: '0', b: '0.5' });
  });

  it('手で書き直した1行はまとめない（新しい1行として足す）。merge がなければ今までどおり別の行', () => {
    let t = { notes: '', measures: [] };
    t = add(t, rec('根株', { size: [{ w: '40', h: '20' }] }));
    t = { ...t, notes: '・根株の腐朽：40×20cm（南側）' };
    t = add(t, rec('根株', { size: [{ w: '50', h: '10' }] }));
    expect(t.notes).toBe('・根株の腐朽：40×20cm（南側）\n・根株の腐朽：50×10cm');
    const off = { ...c, noteMeasures: { ...c.noteMeasures, merge: false } };
    let u = { notes: '', measures: [] };
    u = { ...u, ...addMeasure(u, off, rec('根株', { size: [{ w: '40', h: '20' }] })) };
    u = { ...u, ...addMeasure(u, off, rec('根株', { size: [{ w: '50', h: '10' }] })) };
    expect(u.notes.split('\n')).toHaveLength(2);
  });
});

describe('寸法の1行を一覧表用の特記にも入れる（kinds の db）', () => {
  it('高さと長さの1行（部位は種類の places）', () => {
    expect(measurePlaces('overhang', cfg)).toEqual(['左', '右']);
    expect(measureLine(cfg, 'overhang', '右', { height: { a: '2.5' }, len: '1.2' })).toBe('はみ出し(右)：地上2.5m、L1.2m');
  });
  it('特記事項に残っている寸法の1行は、db の言い回しで一覧表用の特記に入る（定型文と同じく入力した順）', () => {
    const line = measureLine(cfg, 'overhang', '右', { height: { a: '2.5' }, len: '1.2' });
    const t = { notes: '', measures: [] };
    const a = addMeasure({ notes: '・枝の偏り' }, cfg, measureRecord('overhang', '右', { height: { a: '2.5' }, len: '1.2' }, line));
    Object.assign(t, a);
    expect(dbNoteOf(t, cfg)).toBe('枝の偏り、はみ出し(右側)あり。');
    // 写真も定型文と同じ名前
    expect(photoPlan({ ...t, vigor: cfg.options.vigor[0] }, cfg).slots.map((x) => x.name)).toContain('はみ出し枝');
  });
  it('同じ部位の2つ目は①②でまとめた1行になり、一覧表用は1回だけ', () => {
    const mc = structuredClone(cfgJson);
    mc.noteMeasures.merge = true;
    let t = { notes: '', measures: [] };
    for (const len of ['1.2', '0.8']) {
      const v = { height: { a: '2.5' }, len };
      t = { ...t, ...addMeasure(t, mc, measureRecord('overhang', '左', v, measureLine(mc, 'overhang', '左', v))) };
    }
    expect(t.notes).toBe('・はみ出し(左)：①地上2.5m、L1.2m ②地上2.5m、L0.8m');
    expect(dbNoteOf(t, mc)).toBe('はみ出し(左側)あり。');
  });
  it('手で消した・書き換えた行や、db のない種類は入れない', () => {
    const line = measureLine(cfg, 'overhang', '右', { len: '1' });
    expect(autoDbNote('・はみ出し(右)：L1m（直した）', cfg, [measureRecord('overhang', '右', { len: '1' }, line)])).toBe('');
    const tap = measureLine(cfg, 'tap', '幹', { height: { a: '1' } });
    expect(autoDbNote(`・${tap}`, cfg, [measureRecord('tap', '幹', { height: { a: '1' } }, tap)])).toBe('');
  });
  it('db は文字でなければ設定の誤り', () => {
    const bad = structuredClone(cfgJson);
    bad.noteMeasures.kinds.find((k) => k.key === 'overhang').db = 1;
    expect(validateConfig(bad).errors.join()).toContain('.db');
  });
});

describe('寸法から写した2つの数の比（詳しい診断の pair の ratio.to）', () => {
  it('周囲長／幹周を写すと、文に出さずに持ち、周囲長比の選択肢も決める', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長／幹周', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3', to: 'ratio' } };
    const b4 = c.initialSurvey.forms.initial.sections[1].items[0];
    b4.parts.push('size', 'circ', 'ratio');
    c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '幹', item: 'b4', parts: { size: 'size', circ: 'circ' } });
    expect(validateConfig(c).errors).toEqual([]);
    const values = { circ: { a: '120', b: '187' }, size: [{ w: '100', h: '120' }] };
    const line = measureLine(c, 'decay', '幹', values);
    const r = measuresToInitial({ notes: `・${line}`, measures: [measureRecord('decay', '幹', values, line)] }, c);
    expect(r.values.b4DetailParts.circ).toEqual({ a: '120', b: '187' });
    expect(r.values.b4DetailParts.ratio).toBe('≧1/3');
    expect(r.values.b4Detail).toBe('100×120cm、周囲長比≧1/3');
  });
});

describe('寸法を特記事項の文字から分ける（measuresV 2）', () => {
  const mc = structuredClone(cfgJson);
  mc.noteMeasures.merge = true;
  mc.noteMeasures.parts.memo = { type: 'text', label: '備考' };
  mc.noteMeasures.kinds.find((k) => k.key === 'decay').parts.push('memo');
  const rec = (kind, place, values) => ({ kind, place, values });

  it('新しい形：特記事項の文字には寸法の1行を入れず、野帳の全文では文字の後に並べる（同じ部位・種類は①②）', async () => {
    const { putMeasure, fullNotesOf, measureLinesOf, freeNotesOf, removeMeasure } = await import('../src/core/noteMeasures.js');
    let t = { notes: '・枝の偏り' };
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '1' }, size: [{ w: '10', h: '5' }], memo: '北側' }));
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '2' } }));
    t = putMeasure(t, mc, rec('rod', '根株', { rod: { a: '21', b: '70' } }));
    expect(t.measuresV).toBe(2);
    expect(t.notes).toBe('・枝の偏り');
    expect(freeNotesOf(t, mc)).toBe('・枝の偏り');
    expect(measureLinesOf(t, mc)).toEqual(['幹の腐朽：①地上1m、10cm×5cm、北側 ②地上2m', '根株の鋼棒貫入：21cm/70cm']);
    expect(fullNotesOf(t, mc)).toBe('・枝の偏り\n・幹の腐朽：①地上1m、10cm×5cm、北側 ②地上2m\n・根株の鋼棒貫入：21cm/70cm');
    // 直す（番号で）・消す
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '3' } }), 1);
    expect(measureLinesOf(t, mc)[0]).toBe('幹の腐朽：①地上1m、10cm×5cm、北側 ②地上3m');
    t = removeMeasure(t, mc, 0);
    expect(measureLinesOf(t, mc)).toEqual(['幹の腐朽：地上3m', '根株の鋼棒貫入：21cm/70cm']);
  });

  it('新しい形の寸法も、一覧表用の特記（db）・写真・規則・初期への写しに使う', async () => {
    const { putMeasure, measuresToInitial } = await import('../src/core/noteMeasures.js');
    const { alertsOf } = await import('../src/core/rules.js');
    const t = putMeasure({ notes: '・枝の偏り', vigor: cfg.options.vigor[0], deadBranch: '無' }, mc, rec('overhang', '右', { height: { a: '2.5' }, len: '1.2' }));
    expect(dbNoteOf(t, mc)).toBe('枝の偏り、はみ出し(右側)あり。');
    expect(photoPlan(t, mc).shoot.map((x) => x.name)).toContain('はみ出し枝');
    const d = putMeasure(t, mc, rec('deadBranch', '', { count: '2', height: { a: '3' } }));
    expect(alertsOf(d, mc).map((a) => a.id)).toContain('measureCheck'); // 寸法があるのに③が「無」
    expect(measuresToInitial(d, mc).values.b4Detail).toBe('2本、地上3m');
  });

  it('【移し替え】前の形の木：1行そのままは一覧へ、後ろに言葉を足した行は備考へ、途中を直した行は文字に残す', async () => {
    const { toMeasuresV2, activeMeasures, fullNotesOf } = await import('../src/core/noteMeasures.js');
    const l1 = measureLine(mc, 'decay', '幹', { height: { a: '1' } });
    const l2 = measureLine(mc, 'rod', '根株', { rod: { a: '21', b: '70' } });
    const l3 = measureLine(mc, 'tap', '幹', { height: { a: '2' } });
    const old = {
      notes: `・枝の偏り\n・${l1}、北側に開口\n・${l2}\n・南側の${l3}\n・自由な文`,
      measures: [measureRecord('decay', '幹', { height: { a: '1' } }, l1), measureRecord('rod', '根株', { rod: { a: '21', b: '70' } }, l2), measureRecord('tap', '幹', { height: { a: '2' } }, l3), measureRecord('tap', '幹', { height: { a: '9' } }, '消した行')],
    };
    expect(activeMeasures(old)).toHaveLength(3); // 前と同じく、文字の中に1行が残っているものだけ
    const v2 = toMeasuresV2(old, mc);
    expect(v2.notes).toBe(`・枝の偏り\n・南側の${l3}\n・自由な文`);
    expect(v2.measures).toEqual([
      { kind: 'decay', place: '幹', values: { height: { a: '1' }, memo: '北側に開口' } },
      { kind: 'rod', place: '根株', values: { rod: { a: '21', b: '70' } } },
      { kind: 'tap', place: '幹', values: { height: { a: '2' } } }, // 途中を直した行は、文字にも寸法にも残す（消さない）
    ]);
    expect(fullNotesOf(v2, mc)).toContain(`・${l1}、北側に開口`);
    // 前の形のままの木は、特記事項の文字をそのまま使う（出力は変わらない）
    expect(fullNotesOf(old, mc)).toBe(old.notes);
  });

  it('【移し替え】①②でまとめた1行は、記録ごとに一覧へ分ける', async () => {
    const { toMeasuresV2, measureLinesOf } = await import('../src/core/noteMeasures.js');
    let t = { notes: '' , measures: [] };
    for (const a of ['1', '2']) {
      const v = { height: { a } };
      t = { ...t, ...addMeasure(t, mc, measureRecord('decay', '幹', v, measureLine(mc, 'decay', '幹', v))) };
    }
    expect(t.notes).toBe('・幹の腐朽：①地上1m ②地上2m');
    const v2 = toMeasuresV2(t, mc);
    expect(v2.notes).toBe('');
    expect(v2.measures).toHaveLength(2);
    expect(measureLinesOf(v2, mc)).toEqual(['幹の腐朽：①地上1m ②地上2m']);
  });
});
