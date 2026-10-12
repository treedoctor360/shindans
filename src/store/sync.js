// サーバー（GAS）とのやり取り
//  送信：アプリで入力した木のうち、まだ送っていないもの（sent でないもの）を送る
//  取得：サーバーにある木を受け取り、端末の木に反映する（事務所の PC で使う）
//  ファイル：設定・野帳の原本・台帳をサーバーに置く／受け取る
//
// 本文は JSON の文字として送る（Content-Type を付けないことで、ブラウザの事前確認なしに送れる）

import { groupKey } from '../core/groups.js';
import { toHalf } from '../core/text.js';

// サーバーに送る。返す JSON の ok が false なら、その理由で失敗にする
export async function callServer(server, body, fetchFn = fetch) {
  if (!server?.url) throw new Error('サーバーの URL が設定されていません');
  const res = await fetchFn(server.url, { method: 'POST', body: JSON.stringify({ ...body, pass: server.pass || '' }) });
  if (!res.ok) throw new Error(`サーバーにつながりませんでした（${res.status}）`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('サーバーの返事が読めませんでした（URL が正しいか確認してください）');
  }
  if (!data.ok) throw new Error(data.error || 'サーバーで失敗しました');
  return data;
}

// まだ送っていない木
export const unsentTrees = (state) => state.trees.filter((t) => t.done && t.source === 'app' && !t.sent);

// 木を見分ける鍵（端末とサーバーで共通）
const keyOf = (t) => `${t.siteType || ''}|${toHalf(t.treeNo).trim()}|${t.dupIndex || 1}`;

// 送信する。返す形：{ marks（送れた木の id → 送った時点の更新日時）, saved, conflicts }
//  状態は書き換えない。送信の結果は markSent で「その時点の最新の状態」に当てはめる
export async function sendUnsent(state, cfg, fetchFn = fetch) {
  const list = unsentTrees(state);
  if (!list.length) return { marks: new Map(), saved: 0, conflicts: [] };
  const sheetOf = (t) => cfg.dbFormat.sheets.find((s) => s.type === t.siteType);
  const payload = list.map((t) => ({ ...t, groupName: t[sheetOf(t)?.identify] || '' }));
  const r = await callServer(state.server, { action: 'upsert', year: cfg.job.year, deviceId: state.server.deviceId, trees: payload }, fetchFn);
  const savedIds = new Set(r.saved || []);
  const idOf = (t) => [cfg.job.year, t.siteType || '', toHalf(t.treeNo).trim(), t.dupIndex || 1].join('|');
  const marks = new Map(list.filter((t) => savedIds.has(idOf(t))).map((t) => [t.id, t.updatedAt]));
  return { marks, saved: savedIds.size, conflicts: r.conflicts || [] };
}

// 送れた木に「送信済み」を付ける。送信中に直した木（更新日時が変わった木）は付けない（次の送信でもう一度送る）
export function markSent(state, marks) {
  return { ...state, trees: state.trees.map((t) => (marks.has(t.id) && marks.get(t.id) === t.updatedAt ? { ...t, sent: true } : t)) };
}

// サーバーの木を端末に反映する
//  端末にまだ送っていない入力があり、そちらが新しければ端末を残す（上書きしない）
//  返す形：{ trees, added, updated, kept }
export function mergeServerTrees(localTrees, serverTrees, cfg) {
  const out = localTrees.map((t) => ({ ...t }));
  const index = new Map(out.map((t, i) => [keyOf(t), i]));
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const s of serverTrees) {
    const k = keyOf(s);
    const incoming = { ...s, sent: true };
    delete incoming.groupName;
    if (!index.has(k)) {
      // 端末にない木（別の端末で追加した木など）は、同じまとまりの最後に入れる
      const g = groupKey(incoming, cfg);
      let at = out.length;
      for (let i = out.length - 1; i >= 0; i--)
        if (groupKey(out[i], cfg) === g) {
          at = i + 1;
          break;
        }
      out.splice(at, 0, incoming);
      index.clear();
      out.forEach((t, i) => index.set(keyOf(t), i));
      added++;
      continue;
    }
    const i = index.get(k);
    const local = out[i];
    if (local.source === 'ledger') {
      kept++; // 台帳で入力済みの木は台帳を正とする
      continue;
    }
    if (local.done && !local.sent && String(local.updatedAt || '') > String(s.updatedAt || '')) {
      kept++;
      continue;
    }
    out[i] = { ...incoming, id: local.id, order: local.order, ledgerRow: local.ledgerRow ?? incoming.ledgerRow };
    updated++;
  }
  return { trees: out, added, updated, kept };
}

// サーバーから木を取得する（反映は mergeServerTrees で、その時点の最新の状態に行う）
export async function fetchAll(state, cfg, fetchFn = fetch) {
  const r = await callServer(state.server, { action: 'list', year: cfg.job.year }, fetchFn);
  return r.trees || [];
}

// ArrayBuffer ⇔ base64（ファイルを文字にして送るため）
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export const putFile = (server, kind, name, buffer, fetchFn = fetch) =>
  callServer(server, { action: 'putFile', kind, name, base64: toBase64(buffer) }, fetchFn);

// 返す形：{ name, updated, buffer } または null（まだ置いていない）
export async function getFile(server, kind, fetchFn = fetch) {
  const r = await callServer(server, { action: 'getFile', kind }, fetchFn);
  return r.file ? { name: r.file.name, updated: r.file.updated, buffer: fromBase64(r.file.base64) } : null;
}
