// 画面の骨組み（土台の段階）。中身は「中身の移植」の段階で入れる
import { APP_VERSION } from './version.js';

export default function App() {
  return (
    <div className="app">
      <header className="top">
        <h1>樹木点検 野帳</h1>
        <span className="ver">v{APP_VERSION}</span>
      </header>
      <main className="main">
        <p>準備中です。</p>
      </main>
      <footer className="foot">© 2026– Koh Kitsukawa. All rights reserved.</footer>
    </div>
  );
}
