// 画面の骨組み：上の調査情報バー、中の画面、下のタブ
import { useCallback, useRef, useState } from 'react';
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

// 次の段階で作る画面の仮置き
function Placeholder({ name }) {
  return (
    <section className="view">
      <div className="sec">
        <h2>{name}</h2>
        <p className="hint">この画面は次の段階で作ります。</p>
      </div>
    </section>
  );
}

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
          {slashDate(s.date)}　{s.inspector}
        </div>
      </header>

      {saveError && (
        <div className="alert danger" role="alert" style={{ margin: '12px 16px 0' }}>
          {saveError}
        </div>
      )}

      <main>
        {state.view === 'settings' && <SettingsView {...app} toast={toast} />}
        {state.view === 'list' && <Placeholder name="一覧" />}
        {state.view === 'form' && <Placeholder name="入力" />}
        {state.view === 'out' && <Placeholder name="出力" />}
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
