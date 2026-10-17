// 一覧画面：公園・路線を選び、木の一覧から入力する木を選ぶ
import { groupKey, groupKeys, groupLabel, treesOfGroup } from '../core/groups.js';
import { alertsOf } from '../core/rules.js';
import { monthDay, toHalf } from '../core/text.js';
import { useState } from 'react';
import { addTree } from '../store/actions.js';
import { REVIEW_LABEL, confirmable, reviewState, setConfirm } from '../store/review.js';
import { prevOf } from '../store/previous.js';
import { usePrevIndex } from './usePrevious.js';

const NO_AREA = '本区画';

// 木の状態：未入力 / 詳しい診断待ち / 台帳で入力済み / アプリで入力済み
export function treeState(t, cfg) {
  if (!t.done) return 'todo';
  if (t.initialNeeded === cfg.initial.yes) return 'wait';
  return t.source === 'ledger' ? 'ledger' : 'done';
}

// 「姓 名(資格)・姓 名(資格)」→「姓・姓」
const surnames = (s) =>
  String(s || '')
    .split(/[・、,]/)
    .map((x) => x.replace(/\(.*?\)|（.*?）/g, '').trim().split(/\s+/)[0])
    .filter(Boolean)
    .join('・');

// 確認の段階での絞り込み
const REVIEW_FILTERS = [
  ['asked', '付箋の返事待ち'],
  ['answered', '回答済み'],
  ['submitted', '未確定'],
  ['confirmed', '確定'],
  ['conflict', '食い違い'],
];

export default function ListView({ state, update, config: cfg, send, toast }) {
  const [askBulk, setAskBulk] = useState(false);
  const prevIndex = usePrevIndex();
  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <div className="sec">
          <h2>一覧</h2>
          <p className="hint">「設定」で設定ファイルと台帳を読み込むと、ここに木の一覧が出ます。</p>
          <button type="button" className="btn big" onClick={() => update((s) => ({ ...s, view: 'settings' }))}>
            設定を開く
          </button>
        </div>
      </section>
    );
  }

  const keys = groupKeys(state.trees, cfg);
  const group = keys.includes(state.group) ? state.group : keys[0];
  // 削除した木は「削除した木」の絞り込みでだけ出す（本数にも数えない）
  const inGroup = treesOfGroup(state.trees, group, cfg);
  const deleted = inGroup.filter((t) => t.deleted);
  const all = inGroup.filter((t) => !t.deleted);
  const areas = [...new Set(all.map((t) => t.area || NO_AREA))];
  const area = areas.includes(state.area) ? state.area : '';
  const filter = state.listFilter === 'deleted' && !deleted.length ? 'all' : state.listFilter || 'all';
  const inArea = (t) => !area || (t.area || NO_AREA) === area;
  const rsOf = (t) => (t.conflict ? 'conflict' : reviewState(t, state, cfg));
  const list = (filter === 'deleted' ? deleted : all)
    .filter(inArea)
    .filter(
      (t) =>
        filter === 'deleted' ||
        filter === 'all' ||
        (filter === 'todo' && !t.done) ||
        (filter === 'wait' && treeState(t, cfg) === 'wait') ||
        rsOf(t) === filter,
    );
  const useReview = !!state.server?.url;
  const role = state.user?.role || 'surveyor';
  const bulk = role === 'office' ? confirmable(all.filter(inArea), state, cfg) : [];
  const onBulk = () => {
    const ids = new Set(bulk.map((t) => t.id));
    update(
      (s) => {
        let next = s;
        for (const t of s.trees.filter((x) => ids.has(x.id))) next = setConfirm(next, t, true, cfg);
        return next;
      },
      { now: true },
    ).then(() => send?.());
    toast?.(`${bulk.length}本を確定しました`);
    setAskBulk(false);
  };
  const done = all.filter((t) => t.done).length;
  const wait = all.filter((t) => treeState(t, cfg) === 'wait').length;
  const ledgerDone = all.filter((t) => t.source === 'ledger').length;
  const waitLabel = cfg.initial.waitLabel || '診断待ち';
  const statusLabel = (v) => cfg.statusOptions?.find((o) => o.v === v)?.label ?? v;

  const set = (patch) => update((s) => ({ ...s, ...patch }));
  const open = (id) => update((s) => ({ ...s, group, currentId: id, view: 'form' }));

  return (
    <section className="view">
      <div className="row">
        <label className="lbl" htmlFor="s-group">
          公園・路線
        </label>
        <select
          id="s-group"
          value={group}
          onChange={(e) => set({ group: e.target.value, area: '' })}
          style={{ minHeight: 44, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--sunk)', padding: '0 8px' }}
        >
          {keys.map((k) => {
            const ts = treesOfGroup(state.trees, k, cfg).filter((t) => !t.deleted);
            return (
              <option key={k} value={k}>
                {groupLabel(state.trees, k, cfg)}（{ts.filter((t) => t.done).length}/{ts.length}）
              </option>
            );
          })}
        </select>
      </div>

      <div className="prog">
        <div className="lbl">
          {all.length}本中 {done}本 入力済み{' '}
          <small>
            うち台帳で入力済み {ledgerDone}本・{waitLabel} {wait}本
          </small>
        </div>
        <div className="bar">
          <i style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
        </div>
      </div>

      {areas.length > 1 && (
        <div className="filters">
          {[['', '全区画'], ...areas.map((a) => [a, a])].map(([k, l]) => (
            <button key={k || 'all'} type="button" className={`chip${area === k ? ' on' : ''}`} onClick={() => set({ area: k })}>
              {l}（{k ? all.filter((t) => (t.area || NO_AREA) === k).length : all.length}）
            </button>
          ))}
        </div>
      )}
      <div className="filters">
        {[
          ['all', 'すべて'],
          ['todo', '未入力'],
          ['wait', waitLabel],
          ...(deleted.length ? [['deleted', `削除した木（${deleted.length}）`]] : []),
        ].map(([k, l]) => (
          <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => set({ listFilter: k })} data-filter={k}>
            {l}
          </button>
        ))}
      </div>
      {useReview && (
        <div className="filters" data-testid="review-filters">
          {REVIEW_FILTERS.map(([k, l]) => {
            const n = all.filter(inArea).filter((t) => rsOf(t) === k).length;
            return (
              <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => set({ listFilter: k })} data-filter={k}>
                {l}（{n}）
              </button>
            );
          })}
        </div>
      )}
      {bulk.length > 0 &&
        (askBulk ? (
          <div className="alert info">
            <span>付箋のない提出済みの{bulk.length}本を確定します（{area || 'すべての区画'}）。</span>
            <div className="acts">
              <button type="button" className="btn fill" onClick={onBulk} data-testid="bulk-confirm-ok">
                確定する
              </button>
              <button type="button" className="btn" onClick={() => setAskBulk(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAskBulk(true)} data-testid="bulk-confirm">
            付箋のない提出済みの{bulk.length}本をまとめて確定
          </button>
        ))}

      <div className="cards" data-testid="tree-cards">
        {list.map((t) => {
          const st = treeState(t, cfg);
          const nWarn = t.done && t.source !== 'ledger' ? alertsOf(t, cfg).filter((a) => a.lv !== 'info').length : 0;
          return (
            <button key={t.id} type="button" className="card" onClick={() => open(t.id)} data-tree={toHalf(t.treeNo)}>
              {st === 'todo' ? (
                <span className="pill none">未</span>
              ) : st === 'wait' ? (
                <span className="pill wait">{cfg.initial.pill || '待ち'}</span>
              ) : (
                <span className={`pill ${t.grade}`} style={st === 'ledger' ? { opacity: 0.55 } : undefined}>
                  {t.grade || '?'}
                </span>
              )}
              <span style={{ minWidth: 0 }}>
                <span className="no">{t.treeNo || '(番号なし)'}</span>
                <br />
                <span className="sp">{t.species || '樹種未入力'}</span>
              </span>
              <span className="tags">
                {t.area && <span className="tag">{t.area}</span>}
                {t.source === 'ledger' && (
                  <span className="tag">
                    台帳 {monthDay(t.ledgerDate)} {surnames(t.ledgerInspector)}
                  </span>
                )}
                {t.appBackup && <span className="tag w">アプリ入力の控えあり</span>}
                {t.ledgerDuplicate > 0 && <span className="tag w">番号重複</span>}
                {t.deleted && <span className="tag w">削除</span>}
                {t.status && <span className="tag new">{statusLabel(t.status)}</span>}
                {t.planInitial && <span className="tag w">{cfg.initial.pill || '診断'}予定</span>}
                {nWarn > 0 && <span className="tag w">要確認{nWarn}</span>}
                {prevOf(t, prevIndex, cfg) && <span className="tag prev">{cfg.previous?.label || '前回'}カルテ</span>}
                {useReview && ['asked', 'answered', 'confirmed', 'conflict'].includes(rsOf(t)) && (
                  <span className={`tag rs-${rsOf(t)}`}>{rsOf(t) === 'conflict' ? '食い違い' : REVIEW_LABEL[rsOf(t)]}</span>
                )}
              </span>
            </button>
          );
        })}
        {!list.length && <p className="hint">該当する木はありません。</p>}
      </div>
      <button
        type="button"
        className="btn big"
        onClick={() => update((s) => addTree({ ...s, group }, cfg, { area: area && area !== NO_AREA ? area : '' }))}
      >
        ＋ 一覧にない木を追加
      </button>
    </section>
  );
}

// 一覧で選んでいるまとまりの鍵（ほかの画面でも使う）
export const activeGroup = (state, cfg) => {
  const keys = groupKeys(state.trees, cfg);
  return keys.includes(state.group) ? state.group : keys[0] || '';
};
export { groupKey };
