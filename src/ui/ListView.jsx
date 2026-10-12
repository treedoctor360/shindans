// 一覧画面：公園・路線を選び、木の一覧から入力する木を選ぶ
import { groupKey, groupKeys, groupLabel, treesOfGroup } from '../core/groups.js';
import { alertsOf } from '../core/rules.js';
import { monthDay, toHalf } from '../core/text.js';
import { addTree } from '../store/actions.js';

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

export default function ListView({ state, update, config: cfg }) {
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
  const all = treesOfGroup(state.trees, group, cfg);
  const areas = [...new Set(all.map((t) => t.area || NO_AREA))];
  const area = areas.includes(state.area) ? state.area : '';
  const filter = state.listFilter || 'all';
  const inArea = (t) => !area || (t.area || NO_AREA) === area;
  const list = all
    .filter(inArea)
    .filter((t) => filter === 'all' || (filter === 'todo' && !t.done) || (filter === 'wait' && treeState(t, cfg) === 'wait'));
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
            const ts = treesOfGroup(state.trees, k, cfg);
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
        ].map(([k, l]) => (
          <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => set({ listFilter: k })}>
            {l}
          </button>
        ))}
      </div>

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
                {t.status && <span className="tag new">{statusLabel(t.status)}</span>}
                {t.planInitial && <span className="tag w">{cfg.initial.pill || '診断'}予定</span>}
                {nWarn > 0 && <span className="tag w">要確認{nWarn}</span>}
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
