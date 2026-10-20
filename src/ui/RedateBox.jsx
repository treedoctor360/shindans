// 一覧画面の「調査日をまとめて直す」（調査者だけ）
//  設定画面の調査日を間違えたまま保存した木を、この公園・路線でまとめて直す。直すのは調査日だけ（redate.js）
import { useState } from 'react';
import { datesOf, redate, redateTargets } from '../store/redate.js';
import { toHalf } from '../core/text.js';

const slash = (d) => String(d || '').replace(/-/g, '/');

export default function RedateBox({ state, update, cfg, trees, groupName, send, toast }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const dates = datesOf(state, cfg, trees);
  if (!dates.length) return null;
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)} data-testid="redate-open">
        調査日をまとめて直す
      </button>
    );

  const cur = dates.some((d) => d.date === from) ? from : '';
  const tg = redateTargets(state, cfg, trees, cur);
  const iniLabel = cfg.initialSurvey?.label || '詳しい診断';
  const nos = tg.trees.slice(0, 8).map((t) => toHalf(t.treeNo) || '(番号なし)').join('・') + (tg.trees.length > 8 ? 'ほか' : '');
  const ready = cur && /^\d{4}-\d{2}-\d{2}$/.test(to) && to !== cur && tg.trees.length + tg.initials.length > 0;
  const close = () => {
    setOpen(false);
    setFrom('');
    setTo('');
  };
  const onRun = () => {
    let done = null;
    update(
      (s) => {
        // 実行の時点の最新の状態から、対象を選び直して直す
        const r = redate(s, cfg, trees.map((t) => t.id), cur, to);
        done = r;
        return r.state;
      },
      { now: true },
    ).then(() => {
      if (!done) return;
      send?.();
      toast?.(
        `調査日を ${slash(cur)} → ${slash(to)} に直しました（${done.trees}本` +
          (done.initials ? `・${iniLabel}${done.initials}件` : '') +
          `）` +
          (done.conflicts ? `。食い違いのある${done.conflicts}件は直していません（先にどちらを使うか選んでください）` : ''),
      );
    });
    close();
  };

  return (
    <div className="sec" data-testid="redate">
      <h2>調査日をまとめて直す（{groupName}）</h2>
      <p className="hint">
        設定の調査日を間違えたまま保存した木の、調査日だけを直します（調査者・ほかの入力は変えません。確定も外れません）。
        {cfg.initialSurvey ? `${iniLabel}の記録も、調査日が同じなら一緒に直します。` : ''}台帳で入力済みの木は直せません（台帳を直してください）。
      </p>
      <div className="row">
        <label className="lbl" htmlFor="redate-from">
          間違えた日付
        </label>
        <select id="redate-from" value={cur} onChange={(e) => setFrom(e.target.value)} data-testid="redate-from">
          <option value="">選んでください</option>
          {dates.map((d) => (
            <option key={d.date} value={d.date}>
              {slash(d.date)}（{d.count}本）
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label className="lbl" htmlFor="redate-to">
          正しい日付
        </label>
        <input id="redate-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="redate-to" />
      </div>
      {cur && (
        <p className="hint" data-testid="redate-preview">
          直す木：{tg.trees.length}本{tg.trees.length ? `（${nos}）` : ''}
          {cfg.initialSurvey ? `・${iniLabel}${tg.initials.length}件` : ''}
          {tg.conflicts.length ? `。食い違いのある${tg.conflicts.length}件は直せません` : ''}
        </p>
      )}
      <div className="acts">
        <button type="button" className="btn fill" disabled={!ready} onClick={onRun} data-testid="redate-run">
          {ready ? `${slash(cur)} → ${slash(to)} に直す` : '直す'}
        </button>
        <button type="button" className="btn" onClick={close}>
          やめる
        </button>
      </div>
    </div>
  );
}
