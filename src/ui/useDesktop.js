// デスクトップ表示（一覧・簡易診断・詳しい診断を横に並べる）の切り替え
//  ・画面の幅が十分あるとき（WIDE 以上）だけ使える。狭くなったら自動で今までの表示に戻る
//  ・オン／オフは端末ごとに覚える（ブラウザの localStorage。使えない環境では覚えないだけ）
import { useEffect, useState } from 'react';

export const DESKTOP_WIDE = '(min-width: 1100px)';
const KEY = 'shindans.desktopView';

const load = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const keep = (on) => {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // 覚えられなくても、表示の切り替えはそのまま使える
  }
};

// 返す値：{ wide: 幅が足りるか, on: オンにしてあるか, active: 今デスクトップ表示か, toggle: 切り替える }
export function useDesktop() {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP_WIDE) : null;
  const [wide, setWide] = useState(() => !!mq?.matches);
  const [on, setOn] = useState(load);
  useEffect(() => {
    if (!mq) return undefined;
    const onChange = (e) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const toggle = () =>
    setOn((v) => {
      keep(!v);
      return !v;
    });
  return { wide, on, active: wide && on, toggle };
}
