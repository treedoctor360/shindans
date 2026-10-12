// 画面全体で使う状態の入れ物（React のフック：画面の部品から状態を読み書きする仕組み）
//
// 状態を変えたら、すぐに端末内（IndexedDB）にも保存する。
// 保存に失敗したら saveError に入れて、画面で知らせる（入力が消えたことに気付けるように）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, loadAll, saveState } from '../store/state.js';

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

  // 状態を変える。fn は「今の状態 → 新しい状態」を返す関数
  const update = useCallback(async (fn) => {
    const next = fn(latest.current);
    latest.current = next;
    setState(next);
    try {
      await saveState(next);
      setSaveError('');
    } catch (e) {
      setSaveError(`端末に保存できませんでした：${e.message}`);
    }
  }, []);

  return { state, update, config, setConfig, ready, saveError };
}
