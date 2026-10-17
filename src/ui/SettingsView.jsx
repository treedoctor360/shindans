// 設定画面：調査情報、設定ファイル・野帳の原本・台帳の読み込み
import { useState } from 'react';
import { bookCount } from '../store/initial.js';
import { loadConfigText, importInitialBook, importLedger, saveTemplate } from '../store/state.js';
import PrevSection from './PrevSection.jsx';
import ServerSection from './ServerSection.jsx';

// 今日の日付 "2099-04-05"（端末の時刻で）
export const todayYmd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ファイル選択ボタン（見た目はボタン、中身は <input type="file">）
function FileButton({ label, accept, onFile, disabled, testId }) {
  return (
    <label className={`btn big file-btn${disabled ? ' disabled' : ''}`} aria-disabled={disabled}>
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // 同じファイルをもう一度選べるように
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export default function SettingsView({ state, update, config, setConfig, toast }) {
  const [configErrors, setConfigErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const s = state.session;
  const setSession = (k, v) => update((st) => ({ ...st, session: { ...st.session, [k]: v } }));

  const onConfig = async (file) => {
    const r = await loadConfigText(await file.text(), config);
    setConfigErrors(r.errors);
    if (r.errors.length) {
      toast(config ? '設定ファイルに誤りがあるため、前の設定のまま使います' : '設定ファイルに誤りがあります');
      return;
    }
    setConfig(r.config);
    toast('設定ファイルを読み込みました');
  };

  const onTemplate = async (file) => {
    await saveTemplate(file.name, await file.arrayBuffer());
    update((st) => ({ ...st, templateName: file.name }));
    toast('野帳の原本を読み込みました');
  };

  const onLedger = async (file) => {
    setBusy(true);
    try {
      const r = await importLedger(state, file.name, await file.arrayBuffer(), config, todayYmd());
      await update((st) => ({ ...st, trees: r.state.trees, ledgerInfo: r.state.ledgerInfo, group: st.group || '' }), { now: true });
      const st = r.stats;
      toast(
        `${st.all}本を読み込みました（台帳で入力済み${st.done}本）` +
          (st.conflicts ? `。うち${st.conflicts}本はアプリでも入力済みだったため、台帳を正としました` : '') +
          (st.duplicates.length ? `。番号の重複：${st.duplicates.join('・')}` : ''),
      );
    } catch (e) {
      toast(e.message || '台帳を読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };

  // 詳しい診断のデータ入力用ブック（設定に initialSurvey があるときだけ）
  const onInitialBook = async (file) => {
    setBusy(true);
    try {
      const r = await importInitialBook(state, file.name, await file.arrayBuffer(), config, todayYmd());
      await update((st) => ({ ...st, initialBookInfo: r.state.initialBookInfo }), { now: true });
      const info = r.state.initialBookInfo;
      toast(
        info.errors.length
          ? `見出しが設定と違うシートがあります（${info.errors.length}か所）。そのシートは使いません`
          : `データ入力用ブックを読み込みました（入力済み${bookCount(info)}本）`,
      );
    } catch (e) {
      toast(e.message || 'データ入力用ブックを読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };
  const book = state.initialBookInfo;

  return (
    <section className="view settings">
      <div className="sec">
        <h2>調査情報</h2>
        <div className="row">
          <label className="lbl" htmlFor="s-date">調査日</label>
          <input type="date" id="s-date" value={s.date} onChange={(e) => setSession('date', e.target.value)} />
        </div>
        <div className="row">
          <label className="lbl" htmlFor="s-insp">
            調査者 <small>例：姓 名(資格)・姓 名(資格)</small>
          </label>
          <input type="text" id="s-insp" value={s.inspector} onChange={(e) => setSession('inspector', e.target.value)} />
        </div>
        <p className="hint">木を保存するとき、この日付と調査者をその木に記録します。</p>
      </div>

      <ServerSection state={state} update={update} config={config} setConfig={setConfig} toast={toast} />

      <div className="sec">
        <h2>設定ファイル</h2>
        <div className="hint" data-testid="config-status">
          {config ? (
            <>
              <span className="ok">読み込み済み</span>：{config.job?.title || '（名前なし）'}（版 {config.version}）
            </>
          ) : (
            'まだ読み込んでいません。選択肢・定型文・判定の基準・Excel の書式は、設定ファイルから読み込みます。'
          )}
        </div>
        <FileButton label="設定ファイル（JSON）を読み込む" accept=".json,application/json" onFile={onConfig} testId="config-file" />
        {configErrors.length > 0 && (
          <div className="alert danger" role="alert">
            <b>設定ファイルの誤り（{configErrors.length}件）</b>
            <ul className="err">
              {configErrors.slice(0, 10).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="sec">
        <h2>野帳の原本</h2>
        <div className="hint" data-testid="template-status">
          {state.templateName ? (
            <>
              <span className="ok">読み込み済み</span>：{state.templateName}
            </>
          ) : (
            'まだ読み込んでいません。野帳の Excel 出力に使う、空の様式のファイルです。'
          )}
        </div>
        <FileButton label="野帳の原本（Excel）を読み込む" accept=".xlsx" onFile={onTemplate} testId="template-file" />
      </div>

      <div className="sec">
        <h2>台帳（樹木の一覧表）</h2>
        <div className="hint" data-testid="ledger-status">
          {state.ledgerInfo ? (
            <>
              <span className="ok">読み込み済み</span>：{state.ledgerInfo.name}（{state.ledgerInfo.date}）・{state.trees.length}本
            </>
          ) : (
            'まだ読み込んでいません。'
          )}
        </div>
        <FileButton
          label={busy ? '読み込み中…' : '台帳（Excel）を読み込む'}
          accept=".xlsx,.xlsm"
          onFile={onLedger}
          disabled={!config || busy}
          testId="ledger-file"
        />
        {!config && <p className="hint">先に設定ファイルを読み込んでください（台帳の列の探し方が設定に入っています）。</p>}
        <p className="hint">
          樹木番号・樹種・場所を取り込みます。台帳で入力済みの木は読み取り専用になり、二重調査を防ぎます。アプリで入力した内容は消えません（台帳でも入力済みなら、台帳を正としてアプリの入力は控えに残します）。
        </p>
      </div>

      {config?.initialSurvey && (
        <div className="sec">
          <h2>データ入力用ブック（{config.initialSurvey.label}）</h2>
          <div className="hint" data-testid="initial-book-status">
            {book ? (
              <>
                <span className="ok">読み込み済み</span>：{book.name}（{book.date}）・入力済み{bookCount(book)}本
              </>
            ) : (
              'まだ読み込んでいません。'
            )}
          </div>
          {book?.errors?.length > 0 && (
            <div className="alert warn" data-testid="initial-book-errors">
              <span>見出しが設定と違うため、次のシートは使いません（列の並びが変わっていないか確かめてください）。</span>
              {book.errors.map((e) => (
                <span key={e}>・{e}</span>
              ))}
            </div>
          )}
          <FileButton
            label={busy ? '読み込み中…' : 'データ入力用ブック（Excel）を読み込む'}
            accept=".xlsx,.xlsm"
            onFile={onInitialBook}
            disabled={busy}
            testId="initial-book-file"
          />
          <p className="hint">手で入力済みの木を知り、二重入力を防ぎます。列の並びは変えずに、空いている行へ書き込みます（書き込みは出力の画面から）。</p>
        </div>
      )}

      <PrevSection config={config} toast={toast} />
    </section>
  );
}
