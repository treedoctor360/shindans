// 前回の調査（カルテなど）：事務所の PC で読み込み、要点と写真に分けて端末とサーバーに置く
//
//  要点（prevIndex）… 文字だけ。全部の木の分を1つにまとめる（軽いので、スマホは全部受け取る）
//  写真（prevPhotos:p1, p2 …）… 場所（公園・路線のコード）ごとに1つ。スマホは必要な場所の分だけ端末に入れる
//
// 端末内では IndexedDB の別の場所に置く（入力データの保存とは分ける。入力のたびに大きなデータを書き直さないように）。

import { toHalf } from '../core/text.js';
import { idbGet, idbPut } from './idb.js';
import { fromBase64, getFile, putFile, toBase64 } from './sync.js';

export const INDEX_KEY = 'prevIndex';
export const photoKey = (packId) => `prevPhotos:${packId}`;

// 前回の木の鍵：場所のコード＋樹木番号
export const prevKey = (code, treeNo) => `${toHalf(code || '').trim()}|${toHalf(treeNo || '').trim().toUpperCase()}`;

// 読んだカルテ（readKarteBook の trees を全部つないだもの）から、要点と写真の束を作る
//  返す形：{ index, packs: { packId: { 鍵: [写真…] } }, duplicates: [同じ木が2回以上あった鍵] }
export function buildPrevious(trees, now = new Date().toISOString()) {
  const karte = {};
  const packOf = {}; // 場所のコード → packId
  const packs = {};
  const duplicates = [];
  for (const t of trees) {
    const key = prevKey(t.code, t.treeNo);
    if (karte[key]) duplicates.push(key); // 後から読んだ方を使う（同じカルテを2回読んだときなど）
    if (!packOf[t.code]) packOf[t.code] = `p${Object.keys(packOf).length + 1}`;
    const packId = packOf[t.code];
    const { photos, ...rest } = t;
    karte[key] = { ...rest, photoCount: photos.length, packId };
    packs[packId] = packs[packId] || {};
    packs[packId][key] = photos.map((p) => ({ caption: p.caption, type: p.type, data: toBase64(p.buffer) }));
  }
  const packList = Object.fromEntries(
    Object.entries(packOf).map(([code, id]) => [id, { code, count: Object.values(packs[id]).reduce((n, ps) => n + ps.length, 0) }]),
  );
  return { index: { version: 1, updated: now, karte, packs: packList }, packs, duplicates: [...new Set(duplicates)] };
}

// 木に対応する前回のカルテ
//  返す形：null（なし）/ { karte, speciesMismatch }（樹種が違えば speciesMismatch=true。画面では中身を隠して知らせる）
export function karteOf(tree, index, cfg) {
  if (!index?.karte || !tree?.treeNo) return null;
  const sheet = cfg.dbFormat.sheets.find((s) => s.type === tree.siteType);
  const code = sheet?.code ? tree[sheet.code] : '';
  let k = index.karte[prevKey(code, tree.treeNo)];
  if (!k && !code) {
    // 場所のコードがない木（一覧にない木など）は、番号だけで1つに決まるときだけ
    const no = prevKey('', tree.treeNo).split('|')[1];
    const hits = Object.values(index.karte).filter((x) => x.treeNo === no);
    if (hits.length === 1) [k] = hits;
  }
  if (!k) return null;
  const norm = (s) => toHalf(s || '').replace(/\s/g, '');
  const speciesMismatch = !!(k.species && tree.species && norm(k.species) !== norm(tree.species));
  return { karte: k, speciesMismatch };
}

// ---------- 端末内の保存 ----------

// 画面に「前回のデータが変わった」と知らせる（読み直してもらう）
const changed = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('prev-updated'));

export const loadIndex = () => idbGet(INDEX_KEY);
export const loadPhotos = (packId) => idbGet(photoKey(packId));

// 読み込んだ結果を端末に置く（事務所の PC）
export async function savePrevious({ index, packs }) {
  for (const [id, p] of Object.entries(packs)) await idbPut(photoKey(id), p);
  await idbPut(INDEX_KEY, index);
  changed();
}

// サーバーに置く（事務所の PC）。onProgress(済んだ数, 全部の数)
export async function putPrevious(server, onProgress = () => {}, fetchFn = fetch) {
  const index = await loadIndex();
  if (!index) return 0;
  const ids = Object.keys(index.packs || {});
  const enc = new TextEncoder();
  let done = 0;
  for (const id of ids) {
    const p = await loadPhotos(id);
    if (p) await putFile(server, photoKey(id), `${photoKey(id)}.json`, enc.encode(JSON.stringify(p)).buffer, fetchFn);
    onProgress(++done, ids.length + 1);
  }
  // 要点は最後に置く（写真がそろってから、スマホに知らせる）
  await putFile(server, INDEX_KEY, `${INDEX_KEY}.json`, enc.encode(JSON.stringify(index)).buffer, fetchFn);
  onProgress(ids.length + 1, ids.length + 1);
  return Object.keys(index.karte).length;
}

// サーバーから要点を受け取る（スマホ）。返す形：受け取った本数（なければ 0）
export async function getPreviousIndex(server, fetchFn = fetch) {
  const f = await getFile(server, INDEX_KEY, fetchFn);
  if (!f) return 0;
  const index = JSON.parse(new TextDecoder().decode(f.buffer));
  await idbPut(INDEX_KEY, index);
  changed();
  return Object.keys(index.karte || {}).length;
}

// サーバーから写真を受け取って端末に入れる（スマホ。場所ごと）
export async function getPreviousPhotos(server, packId, fetchFn = fetch) {
  const f = await getFile(server, photoKey(packId), fetchFn);
  if (!f) throw new Error('サーバーにこの場所の写真がありません。事務所の PC でもう一度「サーバーに置く」を押してください');
  await idbPut(photoKey(packId), JSON.parse(new TextDecoder().decode(f.buffer)));
  changed();
}

// 写真を画面に出せる形（data URL）に
export const photoUrl = (p) => `data:${p.type};base64,${p.data}`;
export { fromBase64 };
