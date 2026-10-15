// 前回の調査（カルテなど）：事務所の PC で読み込み、要点と写真に分けて端末とサーバーに置く
//
//  要点（prevIndex）… 文字だけ。全部の木の分を1つにまとめる（軽いので、スマホは全部受け取る）
//  写真（prevPhotos:p1, p2 …）… 場所（公園・路線のコード）ごとに1つ。スマホは必要な場所の分だけ端末に入れる
//
// 端末内では IndexedDB の別の場所に置く（入力データの保存とは分ける。入力のたびに大きなデータを書き直さないように）。

import { toHalf } from '../core/text.js';
import { idbDelete, idbGet, idbPut } from './idb.js';
import { fromBase64, getFile, putFile, toBase64 } from './sync.js';

export const INDEX_KEY = 'prevIndex';
export const photoKey = (packId) => `prevPhotos:${packId}`;

// 前回の木の鍵：場所のコード＋樹木番号
export const prevKey = (code, treeNo) => `${toHalf(code || '').trim()}|${toHalf(treeNo || '').trim().toUpperCase()}`;

// 読んだカルテ（readKarteBook の trees を全部つないだもの）から、要点と写真の束を作る
//  1本の木に、種類の違うカルテ（詳しい診断・周辺の環境・簡単な診断など）が複数あってよい
//  base を渡すと、それに足す（同じ木・同じ種類は新しく読んだ方に入れ替える）。公園ごとなど何回かに分けて読み込めるように
//  返す形：{ index, packs: { packId: { 鍵: { 種類: [写真…] } } }, duplicates: [同じ木・同じ種類が2回以上あったもの] }
export function buildPrevious(kartes, now = new Date().toISOString(), order = [], base = null) {
  const trees = structuredClone(base?.index ? treesOf(base.index) : {});
  const packOf = Object.fromEntries(Object.entries(base?.index?.packs || {}).map(([id, p]) => [p.code, id])); // 場所のコード → packId
  const nextId = () => `p${Math.max(0, ...Object.values(packOf).map((id) => Number(id.slice(1)) || 0)) + 1}`;
  const packs = structuredClone(base?.packs || {});
  const duplicates = [];
  const fresh = new Set(); // 今回読んだもの（同じ回の中で2回出たら知らせる）
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  for (const t of kartes) {
    const key = prevKey(t.code, t.treeNo);
    if (!packOf[t.code]) packOf[t.code] = nextId();
    const packId = packOf[t.code];
    const { photos, ...rest } = t;
    const list = (trees[key] = trees[key] || []);
    const i = list.findIndex((x) => x.kind === t.kind);
    if (i >= 0) {
      if (fresh.has(`${key}#${t.kind}`)) duplicates.push(`${key}（${t.title}）`);
      list.splice(i, 1); // 後から読んだ方を使う
    }
    fresh.add(`${key}#${t.kind}`);
    list.push({ ...rest, photoCount: photos.length, packId });
    list.sort((a, b) => rank(a.kind) - rank(b.kind));
    packs[packId] = packs[packId] || {};
    const had = packs[packId][key];
    packs[packId][key] = { ...(Array.isArray(had) ? { karte: had } : had || {}), [t.kind]: photos.map((p) => ({ caption: p.caption, type: p.type, data: toBase64(p.buffer) })) };
  }
  const count = (id) => Object.values(packs[id]).reduce((n, byKind) => n + Object.values(byKind).reduce((m, ps) => m + ps.length, 0), 0);
  const packList = Object.fromEntries(Object.entries(packOf).map(([code, id]) => [id, { code, count: count(id) }]));
  return { index: { version: 2, updated: now, trees, packs: packList }, packs, duplicates: [...new Set(duplicates)] };
}

// 前の形（版1：1本1カルテ）の要点を、今の形にそろえる
function treesOf(index) {
  if (!index) return {};
  if (index.trees) return index.trees;
  return Object.fromEntries(Object.entries(index.karte || {}).map(([k, v]) => [k, [{ kind: 'karte', title: '', ...v }]]));
}
export const prevCount = (index) => Object.keys(treesOf(index)).length;

// 写真の束から、ある木・ある種類の写真（前の形にも対応）
export function photosOf(pack, key, kind) {
  const v = pack?.[key];
  if (!v) return [];
  return Array.isArray(v) ? v : v[kind] || [];
}

// 木に対応する前回のカルテ
//  返す形：null（なし）/ { kartes: [...], speciesMismatch }（樹種が違えば speciesMismatch=true。画面では中身を隠して知らせる）
export function prevOf(tree, index, cfg) {
  const all = treesOf(index);
  if (!tree?.treeNo || !Object.keys(all).length) return null;
  const sheet = cfg.dbFormat.sheets.find((s) => s.type === tree.siteType);
  const code = sheet?.code ? tree[sheet.code] : '';
  let kartes = all[prevKey(code, tree.treeNo)];
  if (!kartes && !code) {
    // 場所のコードがない木（一覧にない木など）は、番号だけで1つに決まるときだけ
    const no = prevKey('', tree.treeNo).split('|')[1];
    const hits = Object.entries(all).filter(([k]) => k.split('|')[1] === no);
    if (hits.length === 1) kartes = hits[0][1];
  }
  if (!kartes?.length) return null;
  const norm = (s) => toHalf(s || '').replace(/\s/g, '');
  const speciesMismatch = kartes.some((k) => k.species && tree.species && norm(k.species) !== norm(tree.species));
  return { kartes, speciesMismatch };
}

// 野帳に書く前回の印（設定のカルテの種類に fieldSheetMark があるものだけ。例「前回初期(2021)」）
export function fieldSheetMarks(tree, index, cfg, specs) {
  const hit = prevOf(tree, index, cfg);
  if (!hit || hit.speciesMismatch) return [];
  return hit.kartes
    .map((k) => {
      const mark = specs.find((s) => s.id === k.kind)?.fieldSheetMark;
      if (!mark) return '';
      const y = String(k.date || '').slice(0, 4);
      return /^\d{4}$/.test(y) ? `${mark}(${y})` : mark;
    })
    .filter(Boolean);
}

// ---------- 端末内の保存 ----------

// 画面に「前回のデータが変わった」と知らせる（読み直してもらう）
const changed = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('prev-updated'));

export const loadIndex = () => idbGet(INDEX_KEY);
export const loadPhotos = (packId) => idbGet(photoKey(packId));

// 端末にある前回の調査を全部（要点と写真）。足して読み込むときの土台
export async function loadAllPrevious() {
  const index = await loadIndex();
  if (!index) return null;
  const packs = {};
  for (const id of Object.keys(index.packs || {})) packs[id] = (await loadPhotos(id)) || {};
  return { index, packs };
}

// 前回の調査を端末から消す（読み込み直すとき）
export async function clearPrevious() {
  const index = await loadIndex();
  for (const id of Object.keys(index?.packs || {})) await idbDelete(photoKey(id));
  await idbDelete(INDEX_KEY);
  changed();
}

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
  return prevCount(index);
}

// サーバーから要点を受け取る（スマホ）。返す形：受け取った本数（なければ 0）
export async function getPreviousIndex(server, fetchFn = fetch) {
  const f = await getFile(server, INDEX_KEY, fetchFn);
  if (!f) return 0;
  const index = JSON.parse(new TextDecoder().decode(f.buffer));
  await idbPut(INDEX_KEY, index);
  changed();
  return prevCount(index);
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
