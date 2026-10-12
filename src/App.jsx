// 画面の骨組み：上の調査情報バー、中の画面、下のタブ
import { useCallback, useRef, useState } from 'react';
import { groupLabel } from './core/groups.js';
import FormView from './ui/FormView.jsx';
import ListView, { activeGroup } from './ui/ListView.jsx';
import OutView from './ui/OutView.jsx';
import SettingsView from './ui/SettingsView.jsx';
import { useAppState } from './ui/useAppState.js';
import { APP_VERSION } from './version.js';

const TABS = [
  ['list', '一覧'],
  ['form', '入力'],
  ['out', '出力'],
  ['settings', '設定'],
];

// 日付 "2099-04-05" → "2099/4/5"
const slashDate = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-');
  return y ? `${y}/${+m}/${+d}` : '';
};

export default function App() {
  const app = useAppState();
  const { state, update, ready, saveError } = app;

  // 画面下に短いお知らせを出す
  const [toastMsg, setToastMsg] = useState('');
  const timer = useRef(null);
  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(''), 4000);
  }, []);

  const go = (view) => {
    update((s) => ({ ...s, view }));
    window.scrollTo(0, 0);
  };

  if (!ready) return <div className="app"><p className="hint" style={{ padding: 16 }}>読み込み中…</p></div>;

  const s = state.session;
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>{app.config?.job?.title || '樹木点検 野帳'}</h1>
          <span className="proto">v{APP_VERSION}</span>
        </div>
        <div className="meta" data-testid="top-meta">
          {app.config && state.trees.length ? `${groupLabel(state.trees, activeGroup(state, app.config), app.config)}　` : ''}
          {slashDate(s.date)}　{s.inspector}
        </div>
      </header>

      {app.config && state.server?.url && app.sendStatus?.error && state.view !== 'out' && (
        <div className="alert warn" style={{ margin: '12px 16px 0' }}>
          未送信の入力があります（{app.sendStatus.error}）。端末には保存済みです。
        </div>
      )}
      {saveError && (
        <div className="alert danger" role="alert" style={{ margin: '12px 16px 0' }}>
          {saveError}
        </div>
      )}

      <main>
        {state.view === 'settings' && <SettingsView {...app} toast={toast} />}
        {state.view === 'list' && <ListView {...app} />}
        {state.view === 'form' && <FormView key={state.currentId} {...app} toast={toast} />}
        {state.view === 'out' && <OutView {...app} toast={toast} />}
      </main>
      <footer>© 2026– Koh Kitsukawa. All rights reserved.</footer>

      <nav className="tabs">
        <div className="tabs-in">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" className={`tab${state.view === k ? ' on' : ''}`} onClick={() => go(k)}>
              <b>{label}</b>
            </button>
          ))}
        </div>
      </nav>

      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
