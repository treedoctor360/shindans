// 入力画面の上に出す「前回」の欄：前回の詳しい診断（カルテ）の要点・「有」の弱点・写真
//  写真は場所ごとに端末に入れておく（電波がなくても見られるように）。入っていなければ、受け取るボタンを出す
import { useState } from 'react';
import { getPreviousPhotos, karteOf, photoUrl, prevKey } from '../store/previous.js';
import { usePrevIndex, usePrevPhotos } from './usePrevious.js';

const slash = (ymd) => String(ymd || '').replace(/-/g, '/');

export default function PrevPanel({ t, state, config: cfg, toast }) {
  const index = usePrevIndex();
  const hit = karteOf(t, index, cfg);
  const k = hit?.karte;
  const photos = usePrevPhotos(k?.packId);
  const [showAnyway, setShowAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(null); // 大きく表示している写真
  if (!hit) return null;

  const label = cfg.previous?.label || '前回';
  const title = cfg.previous?.karte?.title || 'カルテ';
  const mine = photos?.[prevKey(k.code, k.treeNo)] || [];
  const pack = index.packs?.[k.packId];

  const onGet = async () => {
    setBusy(true);
    try {
      await getPreviousPhotos(state.server, k.packId);
      toast(`${pack?.code || ''} の${label}の写真を端末に入れました（${pack?.count ?? ''}枚）`);
    } catch (e) {
      toast(e.message || '写真を受け取れませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="sec prev" data-testid="prev">
      {/* 閉じていても「前回カルテがある・いつ・弱点と写真の数」は見える。タップで開く */}
      <summary data-testid="prev-open">
        <b>
          {label}の{title}あり
        </b>{' '}
        <span className="hint">
          {slash(k.date)}・弱点{k.items?.length || 0}・写真{k.photoCount}枚（タップで開く）
        </span>
      </summary>
      <div className="hint">{k.inspector}</div>

      {hit.speciesMismatch && !showAnyway ? (
        <div className="alert warn" data-testid="prev-mismatch">
          <span>
            {label}のカルテがありますが、樹種が違います（{label}：{k.species}／今：{t.species}）。番号の付け替えなどで別の木の可能性があります。
          </span>
          <div className="acts">
            <button type="button" className="btn" onClick={() => setShowAnyway(true)}>
              それでも表示する
            </button>
          </div>
        </div>
      ) : (
        <>
          {hit.speciesMismatch && <p className="hint">※ 樹種が違います（{label}：{k.species}）</p>}
          <div className="prev-items" data-testid="prev-items">
            <small>弱点（有のもの）</small>
            {k.items?.length ? (
              <ul>
                {k.items.map((it, i) => (
                  <li key={i}>
                    <b>
                      {it.part && `${it.part} `}
                      {it.item}
                    </b>{' '}
                    {it.result}
                    {it.grade && <span className="tag">{it.grade}</span>}
                    {it.detail && <div className="hint">{it.detail}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="hint">なし</div>
            )}
          </div>

          {k.photoCount > 0 &&
            (mine.length ? (
              <div className="prev-photos" data-testid="prev-photos">
                {mine.map((p, i) => (
                  <button key={i} type="button" className="prev-photo" onClick={() => setBig(p)}>
                    <img src={photoUrl(p)} alt={p.caption} loading="lazy" />
                    <small>{p.caption}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="btn" disabled={busy || !state.server?.url} onClick={onGet} data-testid="prev-get-photos">
                {busy ? '受け取り中…' : `写真${k.photoCount}枚を見る（この場所の${label}の写真${pack?.count ?? ''}枚を端末に入れる）`}
              </button>
            ))}
          {k.summary?.map((s) => (
            <div key={s.label} className="prev-sum">
              <small>{s.label}</small>
              {s.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          ))}
        </>
      )}

      {big && (
        <button type="button" className="photo-big" onClick={() => setBig(null)} aria-label="閉じる">
          <img src={photoUrl(big)} alt={big.caption} />
          <span>{big.caption}（タップで閉じる）</span>
        </button>
      )}
    </details>
  );
}
