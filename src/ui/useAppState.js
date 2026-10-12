// 画面全体で使う状態の入れ物（React のフック：画面の部品から状態を読み書きする仕組み）
//
// 状態を変えたら、すぐに端末内（IndexedDB）にも保存する。
// 保存に失敗したら saveError に入れて、画面で知らせる（入力が消えたことに気付けるように）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, loadAll, saveState } from '../store/state.js';
import { markSent, sendUnsent, unsentTrees } from '../store/sync.js';

export function useAppState() {
  const [state, setState] = useState(initialState);
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState('');
  const latest = useRef(state);

  // 起動時に端末から読み込む
  useEffect(() => {
    loadAll()
      .then(({ state: s, config: c }) => {
        latest.current = s;
        setState(s);
        setConfig(c);
      })
      .catch((e) => setSaveError(`端末の保存領域を開けませんでした：${e.message}`))
      .finally(() => setReady(true));
  }, []);

  // 端末への保存。文字を打つたびに全部を書くと重いので、最後の変更から 300ミリ秒後にまとめて保存する。
  // 画面を閉じる・裏に回すときは、待たずにすぐ保存する。
  const timer = useRef(null);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    try {
      await saveState(latest.current);
      setSaveError('');
    } catch (e) {
      setSaveError(`端末に保存できませんでした：${e.message}`);
    }
  }, []);
  useEffect(() => {
    const now = () => timer.current && flush();
    const onHide = () => document.visibilityState === 'hidden' && now();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', now);
    };
  }, [flush]);

  // 状態を変える。fn は「今の状態 → 新しい状態」を返す関数
  //  { now: true } を付けると、待たずにすぐ保存する（「保存」ボタンなど大事な操作）
  const update = useCallback(
    (fn, { now = false } = {}) => {
      const next = fn(latest.current);
      latest.current = next;
      setState(next);
      clearTimeout(timer.current);
      if (now) return flush();
      timer.current = setTimeout(flush, 300);
      return Promise.resolve();
    },
    [flush],
  );

  // ---------- サーバーへの送信 ----------
  // 端末に保存してから送る。失敗しても入力は端末に残り、次の機会（保存のたび・電波が戻ったとき・起動時）に送り直す
  const configRef = useRef(config);
  configRef.current = config;
  const sending = useRef(false);
  const [sendStatus, setSendStatus] = useState({ busy: false, error: '' });
  const send = useCallback(async () => {
    const cfg = configRef.current;
    const s = latest.current;
    if (sending.current || !cfg || !s.server?.url || !unsentTrees(s).length) return null;
    sending.current = true;
    setSendStatus({ busy: true, error: '' });
    try {
      await flush(); // 先に端末へ保存
      const r = await sendUnsent(s, cfg);
      await update((cur) => ({ ...markSent(cur, r.marks), server: { ...cur.server, lastSent: new Date().toISOString() } }), { now: true });
      setSendStatus({ busy: false, error: '' });
      return r;
    } catch (e) {
      setSendStatus({ busy: false, error: e.message || '送信できませんでした' });
      return null;
    } finally {
      sending.current = false;
    }
  }, [flush, update]);

  // 起動時と、電波が戻ったときに送り直す
  useEffect(() => {
    if (!ready) return undefined;
    send();
    const onOnline = () => send();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [ready, send]);

  return { state, update, config, setConfig, ready, saveError, send, sendStatus };
}
