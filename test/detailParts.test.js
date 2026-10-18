// 弱点の詳細の文を、部品から組み立てるテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { buildDetail, partText, partsOf, rebuildDetail, setDetailText, setPart } from '../src/core/detailParts.js';

const cfg = structuredClone(cfgJson);
const b4 = cfg.initialSurvey.forms.initial.sections[1].items[0];

describe('部品の文', () => {
  it('種類ごとの書き方（全角の数字は半角に。空の部品は出さない）', () => {
    const P = cfg.initialSurvey.detailParts;
    expect(partText(P.count, '１')).toBe('1本');
    expect(partText(P.height, { a: '2' })).toBe('地上2m');
    expect(partText(P.height, { a: '0', b: '0.7' })).toBe('地上0～0.7m');
    expect(partText(P.size, [{ w: '10', h: '5' }, { w: '7', h: '7' }])).toBe('10×5cm、7×7cm（2箇所）');
    expect(partText(P.size, [{ w: '20', h: '40' }, {}])).toBe('20×40cm');
    expect(partText(P.branchDia, '18')).toBe('枝直径18cm');
    expect(partText(P.ratio, '＜1/3')).toBe('周囲長比＜1/3');
    expect(partText(P.name, ' 菌の名前 ')).toBe('菌の名前');
    expect(partText({ type: 'pair', label: 'x', unit: 'cm' }, { a: '35', b: '100' })).toBe('35cm/100cm');
    expect(partText(P.height, {})).toBe('');
  });

  it('項目の部品（parts）か、なければ既定の部品で、並び順につなぐ', () => {
    expect(partsOf(b4, cfg).map((p) => p.name)).toEqual(['count', 'height', 'branchDia', 'branchLen']);
    expect(partsOf({ key: 'x', type: 'weak' }, cfg).map((p) => p.name)).toEqual(['height', 'size', 'name']);
    expect(buildDetail({ count: '1', height: { a: '2' }, branchDia: '18', branchLen: '4' }, partsOf(b4, cfg), cfg)).toBe('1本、地上2m、枝直径18cm、枝長4m');
  });
});

describe('記録の詳細の文', () => {
  it('部品を変えると文を作り直す。手で直した後は上書きしない。作り直すと戻る', () => {
    let r = { b4: '有（小）' };
    r = setPart(r, b4, 'b4Detail', 'count', '1', cfg);
    r = setPart(r, b4, 'b4Detail', 'height', { a: '2' }, cfg);
    expect(r.b4Detail).toBe('1本、地上2m');
    r = setDetailText(r, 'b4Detail', '1本、地上2m付近');
    r = setPart(r, b4, 'b4Detail', 'branchLen', '4', cfg);
    expect(r.b4Detail).toBe('1本、地上2m付近'); // 手で直した文はそのまま
    r = rebuildDetail(r, b4, 'b4Detail', cfg);
    expect(r.b4Detail).toBe('1本、地上2m、枝長4m');
    expect(r.b4DetailManual).toBeUndefined();
  });
});

describe('設定の確かめ', () => {
  it('部品の定義の誤りを知らせる。部品は省略してもよい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (fn) => {
      const c = structuredClone(cfgJson);
      fn(c.initialSurvey);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((s) => (s.detailParts.count.type = 'slider'))).toContain('initialSurvey.detailParts.count');
    expect(bad((s) => delete s.detailParts.ratio.options)).toContain('choice には options');
    expect(bad((s) => s.detailPartsDefault.push('nothing'))).toContain('detailPartsDefault');
    expect(bad((s) => (s.forms.initial.sections[0].items[0].parts = ['count']))).toContain('弱点の項目（weak）にだけ');
    expect(bad((s) => (s.forms.initial.sections[1].items[0].parts = ['nothing']))).toContain('.parts に、detailParts にない部品');
    expect(bad((s) => delete s.detailParts)).toContain('detailParts（部品の定義）が必要');
    expect(bad((s) => {
      delete s.detailParts;
      delete s.detailPartsDefault;
    })).toContain('detailParts（部品の定義）が必要'); // 項目の parts だけ残っている
    expect(bad((s) => {
      delete s.detailParts;
      delete s.detailPartsDefault;
      delete s.forms.initial.sections[1].items[0].parts;
    })).toBe('');
  });
});
