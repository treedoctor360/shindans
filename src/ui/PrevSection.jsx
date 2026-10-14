// 設定画面の「前回の調査」欄：前回のカルテ（Excel）をまとめて読み込む（事務所の PC 用）
//  何百ファイルでも、まとめて選ぶ（またはフォルダごと選ぶ）だけでよい。
//  読み込んだ要点と写真は、この端末に置き、「サーバーに置く」でスマホに渡す。元の Excel はサーバーに上げない
import { useState } from 'react';
import { readKarteBook } from '../excel/karte.js';
import { buildPrevious, savePrevious } from '../store/previous.js';
import { usePrevIndex } from './usePrevious.js';

// 複数ファイルを選ぶボタン（folder=true ならフォルダごと）
function FilesButton({ label, folder, onFiles, disabled, testId }) {
  return (
    <label className={`btn big file-btn${disabled ? ' disabled' : ''}`} aria-disabled={disabled}>
      {label}
      <input
        type="file"
        multiple
        accept=".xlsx,.xlsm"
        hidden
        disabled={disabled}
        data-testid={testId}
        {...(folder ? { webkitdirectory: '' } : {})}
        onChange={(e) => {
          const fs = [...(e.target.files || [])].filter((f) => /\.xls[xm]$/i.test(f.name) && !f.name.startsWith('~$'));
          e.target.value = '';
          if (fs.length) onFiles(fs);
        }}
      />
    </label>
  );
}

export default function PrevSection({ config: cfg, toast }) {
  const index = usePrevIndex();
  const [progress, setProgress] = useState('');
  const [problems, setProblems] = useState([]);
  const label = cfg?.previous?.label || '前回';
  const can = !!cfg?.previous?.karte;

  const onFiles = async (files) => {
    const all = [];
    const bad = [];
    const skipped = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`読み込み中 ${i + 1} / ${files.length}：${files[i].name}`);
        try {
          const r = await readKarteBook(await files[i].arrayBuffer(), cfg, files[i].name);
          all.push(...r.trees);
          skipped.push(...r.skipped);
        } catch (e) {
          bad.push(`${files[i].name}：${e.message || '読めませんでした'}`);
        }
      }
      if (!all.length) {
        setProblems(bad);
        toast('カルテが見つかりませんでした（樹木番号の欄があるシートがありません）');
        return;
      }
      setProgress('端末に保存中…');
      const p = buildPrevious(all);
      await savePrevious(p);
      const nPhotos = Object.values(p.index.packs).reduce((n, x) => n + x.count, 0);
      setProblems([...bad, ...(p.duplicates.length ? [`同じ木のカルテが2つ以上（後から読んだ方を使います）：${p.duplicates.join('・')}`] : [])]);
      toast(`${files.length}ファイルから${Object.keys(p.index.karte).length}本分を読み込みました（写真${nPhotos}枚）。「サーバーに置く」でスマホに渡せます`);
      if (skipped.length) console.info('カルテでないシート', skipped);
    } finally {
      setProgress('');
    }
  };

  return (
    <div className="sec">
      <h2>{label}の調査（カルテ）</h2>
      <div className="hint" data-testid="prev-status">
        {index ? (
          <>
            <span className="ok">読み込み済み</span>：{Object.keys(index.karte || {}).length}本・{Object.keys(index.packs || {}).length}か所（
            {String(index.updated || '').slice(0, 10)}）
          </>
        ) : (
          'まだ読み込んでいません。'
        )}
      </div>
      {can ? (
        <>
          <FilesButton label={progress ? '読み込み中…' : 'カルテのファイルを選ぶ（複数可）'} onFiles={onFiles} disabled={!!progress} testId="prev-files" />
          <FilesButton label="フォルダごと選ぶ" folder onFiles={onFiles} disabled={!!progress} testId="prev-folder" />
          {progress && <p className="hint">{progress}</p>}
          {problems.length > 0 && (
            <div className="alert warn">
              <ul className="err">
                {problems.slice(0, 10).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              {problems.length > 10 && <span>ほか{problems.length - 10}件</span>}
            </div>
          )}
          <p className="hint">
            事務所の PC で行います。読み込むと、入力画面にその木の{label}の弱点・評価・写真が出ます。読み直すと、前の分と入れ替わります（全部のファイルをまとめて選んでください）。スマホでは「サーバーから受け取る」で受け取ります。
          </p>
        </>
      ) : (
        <p className="hint">設定ファイルにカルテの読み方（previous.karte）がないため、使えません。</p>
      )}
    </div>
  );
}
