// 出力画面：野帳・一覧表の Excel 出力（照合つき）と、一覧表形式での確認
import { useState } from 'react';
import { groupLabel, treesOfGroup } from '../core/groups.js';
import { toHalf } from '../core/text.js';
import { dbValues, exportDb } from '../excel/dbExport.js';
import { buildPages, exportFieldSheet } from '../excel/fieldSheet.js';
import { exportInitialBook } from '../excel/initialExport.js';
import { initialsForBook } from '../store/initial.js';
import { loadInitialBookFile, loadLedgerFile, loadTemplate } from '../store/state.js';
import { unsentCount } from '../store/sync.js';
import { treesForDb } from '../store/review.js';
import { fieldSheetMarks, loadIndex } from '../store/previous.js';
import { karteSpecs } from '../excel/karte.js';
import { activeGroup } from './ListView.jsx';
import { todayYmd } from './SettingsView.jsx';

// ファイルを端末に保存（ダウンロード）する
function download(filename, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const yymmdd = () => todayYmd().replace(/-/g, '').slice(2);
// ファイル名に使えない文字を除く
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();

// 一覧表形式の列（列のキー → 見出し）
function columns(cfg) {
  const label = {
    date: '調査日', inspector: '調査者', species: '樹種', height: '樹高', girth: '幹周', heightRatio: '樹高/幹径', branchRatio: '枝長/枝径',
    vigor: cfg.vigorLabel, note: '特記事項', initialNeeded: cfg.initial.label, grade: cfg.gradeLabel, treat: '処置', photo: '写真の有無',
  };
  cfg.checks.forEach((c) => (label[c.key] = c.label));
  cfg.rules.filter((r) => r.type === 'treatRequires').forEach((r) => (label[r.field] = r.label));
  return cfg.dbFormat.writeKeys.map((k) => [k, label[k] || k]);
}

// 表のセルに出す文字
function cellText(t, k, v) {
  if (k === 'date') return (t.source === 'ledger' ? t.ledgerDate : t.date || '').replace(/-/g, '/');
  if (k === 'inspector') return t.source === 'ledger' ? t.ledgerInspector : t.inspector;
  if (k === 'branchRatio' && v == null) return t.ledgerBranchRatio || '';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return v ?? '';
}

export default function OutView({ state, update, config: cfg, toast, send, sendStatus }) {
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState(null); // { title, errors }
  const [withUnconfirmed, setWithUnconfirmed] = useState(false); // 未確定の木も一覧表に書き込むか（途中経過の確認用）
  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <p className="hint">「設定」で設定ファイルと台帳を読み込んでください。</p>
      </section>
    );
  }
  const group = activeGroup(state, cfg);
  const gname = groupLabel(state.trees, group, cfg);
  const groupTrees = treesOfGroup(state.trees, group, cfg).filter((t) => !t.deleted); // 削除した木は野帳に出さない
  const mine = state.trees.filter((t) => t.done && t.source === 'app' && !t.deleted);
  const shown = groupTrees.filter((t) => t.done);
  const cols = columns(cfg);
  const useReview = !!state.server?.url;
  const db = treesForDb(state, cfg, { includeUnconfirmed: withUnconfirmed });
  const dbCount = mine.length - db.excluded.length;
  const ini = cfg.initialSurvey ? initialsForBook(state, cfg, { includeUnconfirmed: withUnconfirmed }) : null;

  const run = async (name, fn) => {
    setBusy(name);
    setCheck(null);
    try {
      await fn();
    } catch (e) {
      setCheck({ title: name, errors: [e.message || String(e)] });
    } finally {
      setBusy('');
    }
  };

  const onField = () =>
    run('野帳の出力', async () => {
      const tpl = await loadTemplate();
      if (!tpl) throw new Error('野帳の原本がありません。「設定」で読み込んでください');
      // 前回の調査の印（前回に詳しい診断をした木など）を付けてから用紙に分ける
      const index = await loadIndex();
      const specs = karteSpecs(cfg);
      const marked = groupTrees.map((t) => ({ ...t, prevMarks: fieldSheetMarks(t, index, cfg, specs) }));
      const pages = buildPages(marked, cfg);
      const r = await exportFieldSheet(tpl.buffer.slice(0), pages, cfg, { title: gname.replace(/^\[.*?\]\s*/, '') });
      if (r.errors.length) return setCheck({ title: '野帳の出力検査', errors: r.errors });
      const sheet = cfg.dbFormat.sheets.find((s) => s.type === groupTrees[0]?.siteType);
      download(`野帳_${safeName(groupTrees[0]?.[sheet?.identify]) || '野帳'}_${yymmdd()}.xlsx`, r.buffer);
      const nDone = groupTrees.filter((t) => t.done).length;
      const nMarked = marked.filter((t) => t.prevMarks.length).length;
      toast(`検査OK（${pages.length}枚・入力済み${nDone}本の全項目が一致${nMarked ? `・前回の印${nMarked}本` : ''}）。保存しました`);
    });

  const onDb = () =>
    run('一覧表の出力', async () => {
      const ledger = await loadLedgerFile();
      if (!ledger) throw new Error('台帳がありません。「設定」で読み込んでください');
      const r = await exportDb(ledger.buffer.slice(0), db.trees, cfg);
      if (r.errors.length) return setCheck({ title: '一覧表の出力検査', errors: r.errors });
      download(`${safeName(ledger.name.replace(/\.xls[xm]$/i, ''))}_入力反映_${yymmdd()}.xlsx`, r.buffer);
      const st = r.stats;
      toast(
        `検査OK。${st.written + st.appended}本を書き込みました（既存の行${st.written}・追加${st.appended}）。他の行は変わっていません` +
          (st.skippedLedgerDone.length ? `。台帳で入力済みの${st.skippedLedgerDone.length}本は書き込んでいません` : '') +
          (db.excluded.length ? `。未確定の${db.excluded.length}本は書き込んでいません` : ''),
      );
    });

  // 詳しい診断の記録を、データ入力用ブックに書き込む
  const onInitial = () =>
    run(`${cfg.initialSurvey.label}の出力`, async () => {
      const file = await loadInitialBookFile();
      if (!file) throw new Error('データ入力用ブックがありません。「設定」で読み込んでください');
      const r = await exportInitialBook(file.buffer.slice(0), ini.records, cfg);
      if (r.errors.length) return setCheck({ title: `${cfg.initialSurvey.label}の出力検査`, errors: r.errors });
      const n = new Set(r.stats.written.map((w) => w.treeNo)).size;
      if (!n) return toast('書き込む木がありませんでした（ブックで入力済みの木は書き込みません）');
      download(`${safeName(file.name.replace(/\.xls[xm]$/i, ''))}_入力反映_${yymmdd()}.xlsx`, r.buffer);
      toast(
        `検査OK。${n}本を書き込みました。ほかの行・入力規則などは変わっていません` +
          (r.stats.skippedInBook.length ? `。ブックで入力済みの${r.stats.skippedInBook.length}本（${r.stats.skippedInBook.slice(0, 5).join('・')}）は書き込んでいません` : '') +
          (r.stats.skippedNoNumber ? `。番号のない${r.stats.skippedNoNumber}本は書き込んでいません` : ''),
      );
    });

  const unsent = unsentCount(state);
  // 送信と受信をまとめて行う
  const onSync = async () => {
    const r = await send?.();
    if (!r) return;
    const parts = [`送信${r.saved}件`, `他の端末で変わった木${r.changedTrees.length}本`];
    if (r.newStickies) parts.push(`新しい付箋${r.newStickies}件`);
    if (r.conflicts.length) parts.push(`食い違い${r.conflicts.length}本（${r.conflicts.slice(0, 5).join('・')}）`);
    toast(parts.join('・'));
  };

  const onCopy = async () => {
    const head = ['入力元', '樹木番号', ...cols.map((c) => c[1])];
    const rows = shown.map((t) => {
      const v = dbValues(t, cfg);
      return [t.source === 'ledger' ? '台帳' : 'アプリ', toHalf(t.treeNo), ...cols.map(([k]) => cellText(t, k, v[k]))];
    });
    const tsv = [head, ...rows].map((r) => r.map((x) => String(x ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      toast('コピーしました。Excel に貼り付けできます');
    } catch {
      toast('コピーできませんでした');
    }
  };

  return (
    <section className="view">
      {check && (
        <div className="alert danger" role="alert" data-testid="check-errors">
          <span>
            <b>{check.title}</b>：食い違いや問題が{check.errors.length}件見つかったため、保存を中止しました。この画面を撮影して開発者に送ってください。
          </span>
          <span style={{ fontSize: 12 }}>
            {check.errors.slice(0, 15).map((m, i) => (
              <span key={i}>
                {m}
                <br />
              </span>
            ))}
            {check.errors.length > 15 && `ほか${check.errors.length - 15}件`}
          </span>
        </div>
      )}

      <div className="sec">
        <h2>Excel ファイルに出力</h2>
        <button type="button" className="btn fill big" disabled={!!busy} onClick={onField} data-testid="export-field">
          {busy === '野帳の出力' ? '作成中…' : `野帳（Excel）を出力：${gname}`}
        </button>
        <p className="hint">
          野帳の原本に書き込みます（確定していない木も含めて、入力どおりに出します）。選んだ項目は○で囲みます（白黒印刷でも分かります）。未入力の木も番号・樹種が入るので、紙の野帳としても印刷できます。保存する前に、書き出したファイルを読み直して全件照合します。
        </p>
        <button type="button" className="btn big" disabled={!!busy || !dbCount} onClick={onDb} data-testid="export-db">
          {busy === '一覧表の出力'
            ? '作成中…'
            : useReview && !withUnconfirmed
              ? `一覧表に書き込んで出力（確定した${dbCount}本）`
              : `一覧表に書き込んで出力（アプリで入力した${dbCount}本）`}
        </button>
        {useReview && (
          <>
            <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={withUnconfirmed} onChange={(e) => setWithUnconfirmed(e.target.checked)} data-testid="with-unconfirmed" />
              未確定の木も書き込む（途中経過の確認用。提出用には使わない）
            </label>
            {!withUnconfirmed && db.excluded.length > 0 && (
              <p className="hint" data-testid="excluded">
                まだ確定していない{db.excluded.length}本は書き込みません（{db.excluded.slice(0, 8).map((t) => toHalf(t.treeNo)).join('・')}
                {db.excluded.length > 8 ? 'ほか' : ''}）。
              </p>
            )}
          </>
        )}
        <p className="hint">
          {state.ledgerInfo
            ? `読み込んだ「${state.ledgerInfo.name}」の該当する行に書き込みます。台帳にない木は末尾に足します。元のファイルは変わりません。`
            : '先に「設定」で台帳を読み込んでください。'}
        </p>
      </div>

      {ini && (
        <div className="sec" data-testid="initial-export-sec">
          <h2>{cfg.initialSurvey.label}：データ入力用ブックに出力</h2>
          <button type="button" className="btn big" disabled={!!busy || !ini.records.length || !state.initialBookInfo} onClick={onInitial} data-testid="export-initial">
            {busy === `${cfg.initialSurvey.label}の出力`
              ? '作成中…'
              : `データ入力用ブックに書き込んで出力（${useReview && !withUnconfirmed ? '確定した' : '入力済みの'}${ini.records.length}本）`}
          </button>
          {useReview && !withUnconfirmed && ini.excluded.length > 0 && (
            <p className="hint" data-testid="initial-excluded">
              まだ確定していない{ini.excluded.length}本は書き込みません（{ini.excluded.slice(0, 8).map((r) => toHalf(r.treeNo)).join('・')}
              {ini.excluded.length > 8 ? 'ほか' : ''}）。途中経過を見るときは、上の「未確定の木も書き込む」を選んでください。
            </p>
          )}
          {ini.notTarget.length > 0 && (
            <p className="hint" data-testid="initial-not-target">
              簡易診断で「{cfg.initial.label}」が必要でなくなった（または削除した）木の記録{ini.notTarget.length}件は書き込みません（
              {ini.notTarget.slice(0, 8).map((r) => toHalf(r.treeNo)).join('・')}）。
            </p>
          )}
          <p className="hint">
            {state.initialBookInfo
              ? `読み込んだ「${state.initialBookInfo.name}」の、入力済みの最後の行より下の空き行に書き込みます。ブックで入力済みの木は書き込みません。書き込むセルのほかは変えません（列の並び・入力規則・書式もそのまま）。保存する前に、書き出したファイルを読み直して全件照合します。元のファイルは変わりません。`
              : '先に「設定」でデータ入力用ブックを読み込んでください。'}
          </p>
        </div>
      )}

      <div className="sec">
        <h2>サーバー</h2>
        {!state.server?.url ? (
          <p className="hint">「設定」でサーバーの URL と合言葉を入れると、保存のたびに自動で送信します。</p>
        ) : (
          <>
            <div className="lbl" data-testid="send-status">
              アプリで入力 {mine.length}本 ／ 未送信 {unsent}件
              <small>{state.server.lastSent ? `最後に送信：${fmtTime(state.server.lastSent)}` : ''}</small>
            </div>
            {sendStatus?.error && <div className="alert warn">送信できませんでした：{sendStatus.error}（入力は端末に残っています。電波のある所でもう一度送ってください）</div>}
            <button type="button" className="btn big" disabled={sendStatus?.busy} onClick={onSync} data-testid="sync">
              {sendStatus?.busy ? 'やり取り中…' : unsent ? `未送信の${unsent}件を送って、最新を受け取る` : 'サーバーから最新を受け取る'}
            </button>
            <p className="hint">
              起動時・保存のたび・電波が戻ったときにも自動で行います。他の人が先に直していた木は上書きせず、どちらを使うかを聞きます。
            </p>
          </>
        )}
      </div>

      <div className="sec">
        <h2>一覧表形式：{gname}</h2>
        <div className="hint">
          入力済み {shown.length}本（アプリ {shown.filter((t) => t.source === 'app').length}本・台帳 {shown.filter((t) => t.source === 'ledger').length}本）。色付きの行がアプリで入力した木です。
        </div>
        <div className="tbl">
          <table data-testid="out-table">
            <thead>
              <tr>
                <th>入力元</th>
                <th>樹木番号</th>
                {cols.map(([k, l]) => (
                  <th key={k}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const v = dbValues(t, cfg);
                return (
                  <tr key={t.id} style={t.source === 'app' ? { background: 'var(--accent-soft)' } : undefined}>
                    <td>{t.source === 'ledger' ? '台帳' : 'アプリ'}</td>
                    <td>{toHalf(t.treeNo)}</td>
                    {cols.map(([k]) => (
                      <td key={k} style={{ whiteSpace: 'pre-line' }}>
                        {cellText(t, k, v[k])}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={cols.length + 2}>入力済みの木はまだありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn" onClick={onCopy}>
          表をコピー（Excel に貼り付けできます）
        </button>
      </div>
    </section>
  );
}
