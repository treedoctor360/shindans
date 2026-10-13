// =============================================================
//  サーバー（Google Apps Script）
//  スプレッドシートに付いたスクリプトとして置き、ウェブアプリとして公開する。
//  手順は gas/README.md を参照。
//
//  受け付ける操作（すべて POST。本文は JSON の文字）
//    { action: 'ping' }                         … 合言葉の確認
//    { action: 'upsert', year, deviceId, trees }  … 木のデータを保存（同じIDは上書き。新しいものだけ）
//    { action: 'list', year }                     … 保存してある木の一覧
//    { action: 'putFile', kind, name, base64 }    … 設定・原本・台帳のファイルを置く（事務所のPCから）
//    { action: 'getFile', kind }                  … 置いたファイルを取り出す（スマホから）
//  どの操作にも pass（合言葉）を付ける。合言葉はスクリプトのプロパティ PASSPHRASE に入れる。
// =============================================================

var SHEET_NAME = 'trees';
var HEADER = ['ID', '樹木番号', '何本目', '種類', '場所', '更新日時', '受信日時', '端末', 'データ'];
var FILE_KINDS = ['config', 'template', 'ledger'];

// ---------- 計算だけの部分（テストで Node から呼べるように、Google の機能を使わない） ----------

// 木のID：年度・シートの種類・番号・何本目
function treeId(t, year) {
  return [year, t.siteType || '', String(t.treeNo || '').trim(), t.dupIndex || 1].join('|');
}

// 保存してある行（見出しを除く）に、届いた木を反映する
// 同じIDで、届いた方が新しい（更新日時が同じか後）なら上書き。古ければ取り込まない（conflicts に入れる）
// 返す形：{ updates: [{ index, row }], appends: [row], saved: [id], conflicts: [id] }
function planUpsert(rows, trees, year, now, deviceId) {
  var byId = {};
  for (var i = 0; i < rows.length; i++) byId[rows[i][0]] = i;
  var out = { updates: [], appends: [], saved: [], conflicts: [] };
  var seen = {};
  for (var k = 0; k < trees.length; k++) {
    var t = trees[k];
    if (!t || !String(t.treeNo || '').trim()) continue;
    var id = treeId(t, year);
    if (seen[id]) continue; // 同じ送信の中の重複は最初のものだけ
    seen[id] = true;
    var row = [id, String(t.treeNo).trim(), t.dupIndex || 1, t.siteType || '', t.groupName || '', t.updatedAt || '', now, deviceId || '', JSON.stringify(t)];
    if (byId[id] === undefined) {
      out.appends.push(row);
      out.saved.push(id);
      continue;
    }
    var old = rows[byId[id]];
    if (String(old[5] || '') > String(t.updatedAt || '')) {
      out.conflicts.push(id); // サーバーの方が新しい
      continue;
    }
    out.updates.push({ index: byId[id], row: row });
    out.saved.push(id);
  }
  return out;
}

// 保存してある行から、その年度の木を取り出す
function listTrees(rows, year) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).split('|')[0] !== String(year)) continue;
    try {
      out.push(JSON.parse(rows[i][8]));
    } catch (e) {
      // 壊れた行は飛ばす
    }
  }
  return out;
}

// ---------- Google の機能を使う部分 ----------

function doPost(e) {
  var res;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ブラウザで URL を開いたとき（動いているかの確認だけ。データは返さない）
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '動いています' })).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('PASSPHRASE');
  if (!pass) return { ok: false, error: 'サーバーに合言葉（PASSPHRASE）が設定されていません' };
  if (req.pass !== pass) return { ok: false, error: '合言葉が違います' };

  if (req.action === 'ping') return { ok: true };
  if (req.action === 'list') return { ok: true, trees: listTrees(readRows(), req.year) };
  if (req.action === 'upsert') return withLock(function () { return upsert(req); });
  if (req.action === 'putFile') return withLock(function () { return putFile(req, props); });
  if (req.action === 'getFile') return getFile(req, props);
  return { ok: false, error: '知らない操作です：' + req.action };
}

// 同時に書き込まないように順番待ちをする（最大30秒）
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 保存先のスプレッドシート
//  スプレッドシートの「拡張機能 → Apps Script」から作ったスクリプトなら、そのスプレッドシート。
//  ウェブアプリとして呼ばれたときに見つからない場合に備えて、スクリプトのプロパティ SPREADSHEET_ID も見る。
//  どちらも無ければ、初回に新しいスプレッドシートを作らずに、分かる言葉で知らせる。
function spreadsheet() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('保存先のスプレッドシートが分かりません。スクリプトのプロパティに SPREADSHEET_ID（スプレッドシートの URL の /d/ と /edit の間の文字）を追加してください');
}

function sheet() {
  var ss = spreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
    sh.getRange('A:I').setNumberFormat('@'); // すべて文字として保存（日付や数に勝手に変えられないように）
  }
  return sh;
}

function readRows() {
  var sh = sheet();
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, HEADER.length).getValues() : [];
}

function upsert(req) {
  if (!req.year) return { ok: false, error: '年度がありません' };
  var sh = sheet();
  var rows = readRows();
  var plan = planUpsert(rows, req.trees || [], req.year, new Date().toISOString(), req.deviceId);
  plan.updates.forEach(function (u) {
    sh.getRange(u.index + 2, 1, 1, HEADER.length).setValues([u.row]);
  });
  if (plan.appends.length) sh.getRange(sh.getLastRow() + 1, 1, plan.appends.length, HEADER.length).setValues(plan.appends);
  return { ok: true, saved: plan.saved, conflicts: plan.conflicts };
}

// ファイルはスプレッドシートと同じフォルダの中の「データ」フォルダに置く
function dataFolder(props) {
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // 消されていたら作り直す
    }
  }
  var ssFile = DriveApp.getFileById(spreadsheet().getId());
  var parents = ssFile.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = parent.createFolder('データ');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function putFile(req, props) {
  if (FILE_KINDS.indexOf(req.kind) < 0) return { ok: false, error: 'ファイルの種類が違います' };
  var folder = dataFolder(props);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), 'application/octet-stream', req.name);
  var file = folder.createFile(blob);
  var oldId = props.getProperty('FILE_' + req.kind);
  props.setProperty('FILE_' + req.kind, file.getId());
  props.setProperty('NAME_' + req.kind, req.name);
  if (oldId) {
    try {
      DriveApp.getFileById(oldId).setTrashed(true); // 前のファイルはゴミ箱へ（30日は戻せる）
    } catch (e) {
      // 既に無ければそのまま
    }
  }
  return { ok: true, updated: file.getLastUpdated().toISOString() };
}

function getFile(req, props) {
  if (FILE_KINDS.indexOf(req.kind) < 0) return { ok: false, error: 'ファイルの種類が違います' };
  var id = props.getProperty('FILE_' + req.kind);
  if (!id) return { ok: true, file: null };
  var file = DriveApp.getFileById(id);
  return {
    ok: true,
    file: {
      name: props.getProperty('NAME_' + req.kind) || file.getName(),
      updated: file.getLastUpdated().toISOString(),
      base64: Utilities.base64Encode(file.getBlob().getBytes()),
    },
  };
}

// テスト（Node）から計算部分を読めるようにする。Google の上では module が無いので何もしない
if (typeof module !== 'undefined') module.exports = { treeId: treeId, planUpsert: planUpsert, listTrees: listTrees };
