// 入力画面：1本ずつ、紙の野帳と同じ順に入力する
import { useState } from 'react';
import { branchRatioRaw, branchRatioText, girthOf, heightRatioOf } from '../core/calc.js';
import { groupLabel, treesOfGroup } from '../core/groups.js';
import { dbNoteOf, freeNoteLines, noteLines, toggleNote } from '../core/notes.js';
import { photoFlag, photoPlan } from '../core/photo.js';
import { alertsOf, missingFields } from '../core/rules.js';
import { num, toHalf } from '../core/text.js';
import { composeTreat } from '../core/treat.js';
import { isDead, isLocked } from '../core/tree.js';
import { normalizeField, pressAlertAction, pressOption, saveTree, toggleTreat, touched, updateTree } from '../store/actions.js';
import { activeGroup } from './ListView.jsx';
import ReviewPanel from './ReviewPanel.jsx';

const MODE_TEXT = { 'full+weak': '全景＋弱点写真', shared: '全景と共用', fullOnly: '全景だけ（写真で見えない弱点のみ）' };

// 選択ボタンの並び
function Seg({ field, opts, value, onPress, disabled, className = '', labels }) {
  return (
    <div className={`seg ${className}`} role="group" data-group={field}>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          className={`seg-b${value === o ? ' on' : ''}`}
          data-v={o}
          aria-pressed={value === o}
          disabled={disabled}
          onClick={() => onPress(field, o)}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

// 注意・提案の一覧
function Alerts({ list, onAct }) {
  return (
    <div className="alerts">
      {list.map((a) => (
        <div key={a.id} className={`alert ${a.lv}`} data-alert={a.id}>
          <span>{a.msg}</span>
          {a.acts?.length > 0 && (
            <div className="acts">
              {a.acts.map((act) => (
                <button key={act.label} type="button" className="btn" onClick={() => onAct(a, act)}>
                  {act.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function FormView({ state, update, config: cfg, toast, send }) {
  const [showAllChips, setShowAllChips] = useState(false);
  const [missingAsk, setMissingAsk] = useState(null); // 保存しようとしたときの未入力の一覧

  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <p className="hint">「設定」で設定ファイルと台帳を読み込んでください。</p>
      </section>
    );
  }
  const group = activeGroup(state, cfg);
  const ts = treesOfGroup(state.trees, group, cfg);
  let t = ts.find((x) => x.id === state.currentId);
  if (!t) t = ts.find((x) => !x.done) || ts[0];
  if (!t) return <section className="view"><p className="hint">木がありません。</p></section>;

  const idx = ts.indexOf(t);
  // 台帳で入力済みの木は直せない。事務の端末では、提出された木は直さず付箋で修正案を出す
  const officeView = state.user?.role === 'office' && t.source === 'app' && t.done;
  const readOnly = t.source === 'ledger' || officeView;
  const locked = isLocked(t, cfg);
  // 入力済みの木を直したら、送り直しの印を付ける
  const change = (fn, opt) => update((s) => updateTree({ ...s, currentId: t.id, group }, t.id, (x) => touched(fn(x))), opt);
  const setField = (k, v) => change((x) => ({ ...x, [k]: v, ...(k === 'dbNote' ? { dbNoteManual: true } : {}) }));
  const blurField = (k) => change((x) => normalizeField(x, k, cfg));
  const press = (field, v) => change((x) => pressOption(x, field, v, cfg));
  const go = (id) => {
    setMissingAsk(null);
    update((s) => ({ ...s, currentId: id, group }));
    window.scrollTo(0, 0);
  };

  const onAct = (a, act) => {
    update((s) => pressAlertAction({ ...s, currentId: t.id }, t.id, act, a.id, cfg));
    if (act.type === 'addNote') toast('特記事項に理由を入れました。必要なら書き換えてください');
    if (act.type === 'resurvey') toast('再調査として入力できるようにしました（台帳の値を下書きにしています）');
    if (act.type === 'useApp') toast('アプリの入力に戻しました');
  };

  const onSave = (force = false) => {
    const r = saveTree({ ...state, currentId: t.id, group }, cfg, { force });
    if (!r.saved) {
      setMissingAsk(r.missing);
      return;
    }
    setMissingAsk(null);
    update(() => r.state, { now: true }).then(() => send?.()); // 端末に保存してから、裏でサーバーへ送る
    toast(`${toHalf(t.treeNo) || 'この木'} を保存しました`);
    window.scrollTo(0, 0);
  };

  // 表示する値
  const sheet = cfg.dbFormat.sheets.find((s) => s.type === t.siteType);
  const place = [groupLabel(state.trees, group, cfg), t.place].filter(Boolean).join('　');
  const g = girthOf(t, cfg);
  const hd = heightRatioOf(t, cfg);
  const blr = isDead(t, cfg) ? null : branchRatioRaw(t);
  const bl = branchRatioText(t, cfg);
  const gv = (t.girths || []).map(num).filter(Boolean);
  const ratioRule = cfg.rules.find((r) => r.type === 'ratioAtLeast');
  const limit = (kind) => ratioRule?.items.find((i) => i.ratio === kind)?.threshold ?? Infinity;
  const treat = composeTreat(t, cfg);
  const plan = photoPlan(t, cfg);
  const autoPhoto = plan.weakPhoto ? cfg.photo.flagYes : cfg.photo.flagNo;
  const alerts = alertsOf(t, cfg);
  const topAlerts = alerts.filter((a) => a.acts?.some((x) => ['resurvey', 'useApp'].includes(x.type)));
  const otherAlerts = alerts.filter((a) => !topAlerts.includes(a));
  const chipsShow = cfg.noteChipsShow ?? 10;
  const lines = noteLines(t.notes);
  const free = freeNoteLines(t.notes, cfg);
  const strongWords = cfg.rules.filter((r) => r.type === 'contains').flatMap((r) => r.anyOf);
  const treeNoRule = cfg.rules.find((r) => r.type === 'treeNoPattern');
  const badNo = !!t.treeNo && treeNoRule && !new RegExp(treeNoRule.pattern).test(toHalf(t.treeNo));
  const gradeLocked = t.initialNeeded === cfg.initial.yes;
  const missing = readOnly ? [] : missingFields(t, cfg);
  const isOn = (k, v) => t[k] === v;
  const felling = cfg.rules.filter((r) => r.type === 'treatRequires').filter((r) => new RegExp(r.pattern).test(treat));

  return (
    <section className="view" data-testid="form">
      <div className="sub" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" disabled={idx <= 0} onClick={() => go(ts[idx - 1].id)}>
          ← 前の木
        </button>
        <span className="hint">
          {idx + 1} / {ts.length}
        </span>
        <button type="button" className="btn" disabled={idx >= ts.length - 1} onClick={() => go(ts[idx + 1].id)}>
          次の木 →
        </button>
      </div>

      <ReviewPanel t={t} state={state} update={update} config={cfg} toast={toast} send={send} />
      {officeView && <p className="hint">事務の端末では入力内容を直せません。直してほしいところは付箋の修正案で伝えます。</p>}

      <fieldset disabled={readOnly} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="sec">
          <h2>樹木</h2>
          <div className="hint">{place}</div>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-treeNo">
                樹木番号
              </label>
              <input
                type="text"
                id="f-treeNo"
                className={`num${badNo ? ' bad' : ''}`}
                value={t.treeNo}
                autoCapitalize="characters"
                placeholder={cfg.treeNoPlaceholder || ''}
                onChange={(e) => setField('treeNo', e.target.value)}
                onBlur={() => blurField('treeNo')}
              />
            </div>
            <div className="row">
              <label className="lbl" htmlFor="f-species">
                樹種
              </label>
              <input
                type="text"
                id="f-species"
                list="spList"
                value={t.species}
                onChange={(e) => setField('species', e.target.value)}
                onBlur={() => {
                  const after = normalizeField(t, 'species', cfg).species;
                  if (after !== t.species.trim()) toast(`${t.species.trim()} → ${after} に置き換えました`);
                  blurField('species');
                }}
              />
            </div>
          </div>
          <datalist id="spList">
            {cfg.species.list.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {cfg.statusOptions && (
            <div className="row">
              <span className="lbl">状態</span>
              <div className="seg" role="group">
                {cfg.statusOptions.map((o) => (
                  <button
                    key={o.v || 'none'}
                    type="button"
                    className={`seg-b${(t.status || '') === o.v ? ' on' : ''}`}
                    onClick={() => setField('status', o.v)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="row">
            <label className="lbl" htmlFor="f-prev">
              前回の特記 <small>野帳では樹木番号の横に出ます</small>
            </label>
            <input type="text" id="f-prev" value={t.prevNote || ''} onChange={(e) => setField('prevNote', e.target.value)} />
          </div>
        </div>

        <div className="sec">
          <h2>計測</h2>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-height">
                樹高
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-height" className="num" value={t.height} onChange={(e) => setField('height', e.target.value)} onBlur={() => blurField('height')} />
                <span>m</span>
              </div>
            </div>
            <div className="row">
              <span className="lbl">
                幹周 <small>株立は幹ごとに</small>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(t.girths || ['']).map((gi, i) => (
                  <div className="unit" key={i}>
                    <input
                      type="text"
                      inputMode="decimal"
                      id={`f-girth${i}`}
                      className="num"
                      aria-label={`幹周${i + 1}`}
                      value={gi}
                      onChange={(e) => change((x) => ({ ...x, girths: x.girths.map((v, j) => (j === i ? e.target.value : v)) }))}
                      onBlur={() => change((x) => ({ ...x, girths: x.girths.map((v) => toHalf(v).trim()) }))}
                    />
                    <span>m</span>
                  </div>
                ))}
              </div>
              <div className="sub">
                <button type="button" className="more" onClick={() => change((x) => ({ ...x, girths: [...x.girths, ''] }))}>
                  ＋ 幹を追加
                </button>
                {t.girths.length > 1 && (
                  <button type="button" className="more" onClick={() => change((x) => ({ ...x, girths: x.girths.slice(0, -1) }))}>
                    − 1本減らす
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-bl">
                枝長
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-bl" className="num" value={t.branchLen} onChange={(e) => setField('branchLen', e.target.value)} onBlur={() => blurField('branchLen')} />
                <span>cm</span>
              </div>
            </div>
            <div className="row">
              <label className="lbl" htmlFor="f-bd">
                枝径
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-bd" className="num" value={t.branchDia} onChange={(e) => setField('branchDia', e.target.value)} onBlur={() => blurField('branchDia')} />
                <span>cm</span>
              </div>
            </div>
          </div>
          <dl className="calc" data-testid="calc">
            <div>
              <dt>幹周(記録値)</dt>
              <dd>{g != null ? `${g.toFixed(2)}m` : '—'}</dd>
            </div>
            <div>
              <dt>樹高/幹径</dt>
              <dd className={(hd ?? 0) >= limit('height') ? 'hit' : ''}>{hd ?? '—'}</dd>
            </div>
            <div>
              <dt>枝長/枝径</dt>
              <dd className={(blr ?? 0) >= limit('branch') ? 'hit' : ''}>{bl === '' ? (t.ledgerBranchRatio || '—') : bl}</dd>
            </div>
          </dl>
          {gv.length > 1 && (
            <div className="calc-note">
              株立：({gv.map((v) => v.toFixed(2)).join('+')})×{cfg.calc.multiStemFactor} = {g.toFixed(2)}m
            </div>
          )}
        </div>

        <div className="sec">
          <h2>点検</h2>
          <div className="row">
            <span className="lbl">{cfg.vigorLabel}</span>
            <Seg field="vigor" opts={cfg.options.vigor} value={t.vigor} onPress={press} />
          </div>
          <fieldset disabled={locked}>
            {cfg.checks.map((c) => {
              const details = cfg.details.filter((d) => d.when.field === c.key);
              return (
                <div key={c.key}>
                  <div className="check">
                    <span className="lbl">{c.label}</span>
                    <Seg field={c.key} opts={cfg.options[c.key]} value={t[c.key]} onPress={press} />
                  </div>
                  {details
                    .filter((d) => isOn(c.key, d.when.eq))
                    .map((d) => (
                      <div className="row" key={d.field} style={{ padding: '6px 0' }}>
                        <label className="lbl" htmlFor={`f-${d.field}`}>
                          {d.label}
                        </label>
                        {d.chips && (
                          <div className="chips">
                            {d.chips.map((w) => (
                              <button
                                key={w}
                                type="button"
                                className={`chip${strongWords.includes(w) ? ' strong' : ''}${t[d.field] === w ? ' on' : ''}`}
                                onClick={() => change((x) => ({ ...x, [d.field]: x[d.field] === w ? '' : w }))}
                              >
                                {w}
                              </button>
                            ))}
                          </div>
                        )}
                        <input
                          type="text"
                          id={`f-${d.field}`}
                          className="num"
                          value={t[d.field] || ''}
                          onChange={(e) => setField(d.field, e.target.value)}
                          onBlur={() => blurField(d.field)}
                        />
                      </div>
                    ))}
                </div>
              );
            })}
            <div className="row" style={{ paddingTop: 8 }}>
              <label className="lbl" htmlFor="f-notes">
                特記事項（野帳） <small>タップで追加・もう一度で削除。寸法なども書く</small>
              </label>
              <div className="chips" data-testid="note-chips">
                {cfg.noteChips.map((c, i) =>
                  !showAllChips && i >= chipsShow ? null : (
                    <button
                      key={c.t}
                      type="button"
                      className={`chip${lines.includes(c.t) ? ' on' : ''}`}
                      onClick={() => change((x) => ({ ...x, notes: toggleNote(x.notes, c.t) }))}
                    >
                      {c.t}
                    </button>
                  ),
                )}
              </div>
              {!showAllChips && cfg.noteChips.length > chipsShow && (
                <button type="button" className="more" onClick={() => setShowAllChips(true)}>
                  定型文をもっと見る（{cfg.noteChips.length - chipsShow}件）
                </button>
              )}
              <textarea id="f-notes" rows={4} value={t.notes} placeholder="1行に1項目（音声入力も可）" onChange={(e) => setField('notes', e.target.value)} />
              <label className="lbl" htmlFor="f-dbnote" style={{ marginTop: 6 }}>
                一覧表用の特記 <small>{t.dbNoteManual ? '手入力' : '定型文から自動で作成'}</small>
              </label>
              <textarea id="f-dbnote" rows={2} value={dbNoteOf(t, cfg)} onChange={(e) => setField('dbNote', e.target.value)} />
              <div className="sub">
                {free.length > 0 && !t.dbNoteManual && (
                  <span className="hint">自由記述（{free.length}行）は一覧表に入りません。必要なら手で追記してください</span>
                )}
                {t.dbNoteManual && (
                  <button type="button" className="more" onClick={() => change((x) => ({ ...x, dbNoteManual: false }))}>
                    自動に戻す
                  </button>
                )}
              </div>
            </div>
          </fieldset>
        </div>

        <div className="sec">
          <h2>判定</h2>
          <div className="row">
            <span className="lbl">{cfg.initial.label}</span>
            <Seg field="initialNeeded" opts={cfg.options.initialNeeded} value={t.initialNeeded} onPress={press} />
          </div>
          <div className="row">
            <span className="lbl">{cfg.gradeLabel}</span>
            <Seg field="grade" opts={cfg.options.grade} value={t.grade} onPress={press} disabled={gradeLocked} className="grade" />
            <div className="hint">{t.grade ? `${t.grade}：${cfg.gradeText?.[t.grade] || ''}` : cfg.gradeHint || ''}</div>
            {gradeLocked && <div className="lock">{cfg.initial.label}が「{cfg.initial.yes}」なので、{cfg.gradeLabel}は空欄にします。</div>}
          </div>
        </div>

        <div className="sec">
          <h2>処置</h2>
          {[
            ['剪定', cfg.treat.prune],
            ['その他', cfg.treat.other],
          ].map(([label, items]) => (
            <div className="row" key={label}>
              <span className="lbl">{label}</span>
              <div className="chips">
                {items.map((c) => (
                  <button key={c} type="button" className={`chip${(t.treatSel || []).includes(c) ? ' on' : ''}`} onClick={() => change((x) => toggleTreat(x, c))}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="row">
            <label className="lbl" htmlFor="f-treat">
              追記 <small>部位など</small>
            </label>
            <input type="text" id="f-treat" value={t.treatFree} onChange={(e) => setField('treatFree', e.target.value)} />
          </div>
          <div className="plan">
            処置：<b data-testid="treat-out">{treat || '（なし）'}</b>
          </div>
          {felling.map((r) => (
            <div className="row" key={r.id}>
              <label className="lbl" htmlFor={`f-${r.field}`}>
                {r.label}
              </label>
              <textarea id={`f-${r.field}`} value={t[r.field] || ''} onChange={(e) => setField(r.field, e.target.value)} />
            </div>
          ))}
        </div>

        <Alerts list={otherAlerts} onAct={onAct} />

        <div className="sec">
          <h2>写真（デジカメで撮影）</h2>
          <div className="plan" data-testid="photo-plan">
            {plan.mode === 'pending'
              ? `${cfg.vigorLabel}などを入力すると、必要な写真を判定します`
              : plan.slots.length
                ? (
                    <>
                      撮る写真：<b>{MODE_TEXT[plan.mode]}</b>
                      <br />
                      {plan.slots.map((x) => `${x.name}（${x.orient}向き）`).join('、')}
                    </>
                  )
                : '写真不要です'}
          </div>
          <div className="row">
            <span className="lbl">
              写真の有無 <small>{t.photoOverride ? `手入力（自動判定は「${autoPhoto}」）` : '自動判定。違う場合はタップで変更'}</small>
            </span>
            <Seg field="photoOverride" opts={[cfg.photo.flagNo, cfg.photo.flagYes]} value={photoFlag(t, cfg)} onPress={press} />
          </div>
        </div>
      </fieldset>

      <Alerts list={topAlerts} onAct={onAct} />
      <div className="savebar">
        {missingAsk && missing.length > 0 ? (
          <div className="alert warn" role="alert">
            <span>未入力があります：{missing.join('、')}</span>
            <div className="acts">
              <button type="button" className="btn" onClick={() => onSave(true)}>
                未入力のまま保存する
              </button>
            </div>
          </div>
        ) : (
          missing.length > 0 && (
            <div className="alert info">
              <span>未入力：{missing.join('、')}</span>
            </div>
          )
        )}
        {!readOnly && (
          <button type="button" className="btn fill big" onClick={() => onSave(false)}>
            保存して次の木へ
          </button>
        )}
        {sheet && <span className="hint" style={{ textAlign: 'center' }}>{sheet.label}</span>}
      </div>
    </section>
  );
}
