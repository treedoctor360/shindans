// 出力画面：野帳・一覧表の Excel 出力（照合つき）と、一覧表形式での確認
import { useState } from 'react';
import { groupLabel, treesOfGroup } from '../core/groups.js';
import { toHalf } from '../core/text.js';
import { dbValues, exportDb } from '../excel/dbExport.js';
import { buildPages, exportFieldSheet } from '../excel/fieldSheet.js';
import { loadLedgerFile, loadTemplate } from '../store/state.js';
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

export default function OutView({ state, config: cfg, toast }) {
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState(null); // { title, errors }
  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <p className="hint">「設定」で設定ファイルと台帳を読み込んでください。</p>
      </section>
    );
  }
  const group = activeGroup(state, cfg);
  const gname = groupLabel(state.trees, group, cfg);
  const groupTrees = treesOfGroup(state.trees, group, cfg);
  const mine = state.trees.filter((t) => t.done && t.source === 'app');
  const shown = groupTrees.filter((t) => t.done);
  const cols = columns(cfg);

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
      const pages = buildPages(groupTrees, cfg);
      const r = await exportFieldSheet(tpl.buffer.slice(0), pages, cfg, { title: gname.replace(/^\[.*?\]\s*/, '') });
      if (r.errors.length) return setCheck({ title: '野帳の出力検査', errors: r.errors });
      const sheet = cfg.dbFormat.sheets.find((s) => s.type === groupTrees[0]?.siteType);
      download(`野帳_${safeName(groupTrees[0]?.[sheet?.identify]) || '野帳'}_${yymmdd()}.xlsx`, r.buffer);
      const nDone = groupTrees.filter((t) => t.done).length;
      toast(`検査OK（${pages.length}枚・入力済み${nDone}本の全項目が一致）。保存しました`);
    });

  const onDb = () =>
    run('一覧表の出力', async () => {
      const ledger = await loadLedgerFile();
      if (!ledger) throw new Error('台帳がありません。「設定」で読み込んでください');
      const r = await exportDb(ledger.buffer.slice(0), state.trees, cfg);
      if (r.errors.length) return setCheck({ title: '一覧表の出力検査', errors: r.errors });
      download(`${safeName(ledger.name.replace(/\.xls[xm]$/i, ''))}_入力反映_${yymmdd()}.xlsx`, r.buffer);
      const st = r.stats;
      toast(
        `検査OK。${st.written + st.appended}本を書き込みました（既存の行${st.written}・追加${st.appended}）。他の行は変わっていません` +
          (st.skippedLedgerDone.length ? `。台帳で入力済みの${st.skippedLedgerDone.length}本は書き込んでいません` : ''),
      );
    });

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
          野帳の原本に書き込みます。選んだ項目は○で囲みます（白黒印刷でも分かります）。未入力の木も番号・樹種が入るので、紙の野帳としても印刷できます。保存する前に、書き出したファイルを読み直して全件照合します。
        </p>
        <button type="button" className="btn big" disabled={!!busy || !mine.length} onClick={onDb} data-testid="export-db">
          {busy === '一覧表の出力' ? '作成中…' : `一覧表に書き込んで出力（アプリで入力した${mine.length}本）`}
        </button>
        <p className="hint">
          {state.ledgerInfo
            ? `読み込んだ「${state.ledgerInfo.name}」の該当する行に書き込みます。台帳にない木は末尾に足します。元のファイルは変わりません。`
            : '先に「設定」で台帳を読み込んでください。'}
        </p>
      </div>

      <div className="sec">
        <h2>サーバーへ送信</h2>
        <p className="hint">次の段階で作ります。</p>
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
