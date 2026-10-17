// 手元だけの再現スクリプト（コミットしない）
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeLedger } from '../../repro-old/test/helpers/makeLedger.js';
import { makeTemplate } from '../../repro-old/test/helpers/makeTemplate.js';

let root = '/home/claude/dist-old';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/shindans/, '');
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f);
  res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(4180);
const URL_ = 'https://example.invalid/exec';
const gas = makeFakeGas();
const net = { online: true };
fs.mkdirSync('/tmp/repro', { recursive: true });
fs.writeFileSync('/tmp/repro/ledger.xlsx', Buffer.from(await makeLedger()));
fs.writeFileSync('/tmp/repro/tpl.xlsx', Buffer.from(await makeTemplate()));
fs.rmSync('/tmp/repro/profile', { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext('/tmp/repro/profile', { viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = ctx.pages()[0] || (await ctx.newPage());
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.route(`${URL_}*`, async (route) => {
  if (!net.online) return route.abort('internetdisconnected');
  const r = await gas.fetchFn(URL_, { body: route.request().postData() });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await r.json()) });
});
const base = 'http://localhost:4180/shindans/';
await page.goto(base);
await page.fill('#s-date', '2099-05-06');
await page.fill('#s-insp', '試験 二郎(資格)');
await page.setInputFiles('[data-testid=config-file]', '../repro-old/test/fixtures/sample-config.json');
await page.setInputFiles('[data-testid=template-file]', '/tmp/repro/tpl.xlsx');
await page.setInputFiles('[data-testid=ledger-file]', '/tmp/repro/ledger.xlsx');
await page.waitForSelector('[data-testid=ledger-status] .ok');
await page.fill('#s-url', URL_);
await page.fill('#s-pass', 'ひみつ');
await page.click('[data-testid=server-put]');
await page.waitForTimeout(500);
// 古い版で番号なしの木を2本
for (const h of ['3', '4']) {
  if (h === '4') net.online = false;
  await page.click('.tab:has-text("一覧")');
  await page.click('text=一覧にない木を追加');
  await page.click('[data-v="テープなし"]').catch(() => {});
  await page.fill('#f-species', 'ヤマグワ');
  await page.fill('#f-height', h);
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');
  await page.waitForTimeout(800);
}
await page.click('.tab:has-text("出力")');
await page.waitForTimeout(800);
const dump = async (label) => {
  const s = await page.evaluate(() => new Promise((ok) => {
    const rq = indexedDB.open('shindans'); rq.onsuccess = () => { const db = rq.result; const names = [...db.objectStoreNames]; const tx = db.transaction(names[0]); const g = tx.objectStore(names[0]).get('state'); g.onsuccess = () => ok(g.result); };
  }));
  console.log(label, JSON.stringify((s?.trees || []).filter((t) => !t.ledgerRow).map((t) => ({ id: t.id, uid: t.uid, no: t.treeNo, h: t.height, done: t.done, sent: t.sent, rev: t.rev, conflict: !!t.conflict, deleted: t.deleted }))));
};
await dump('OLD');
console.log('server records', gas.sheets.get('records').cells.slice(1).map((r) => [r[0], r[4]]));
// 新しい版へ
net.online = true;
root = '/home/claude/dist-new';
await page.goto(base);
await page.waitForTimeout(1000);
await dump('NEW-start');
await page.click('.tab:has-text("一覧")');
const cards = page.locator('.card:has-text("(番号なし)")');
console.log('cards', await cards.count());
await cards.nth(Number(process.env.WHICH||0)).click();
console.log('opened no=', await page.inputValue('#f-treeNo'), 'species=', await page.inputValue('#f-species'), 'h=', await page.inputValue('#f-height'));
console.log('buttons', await page.locator('[data-testid=remove-tree]').allTextContents(), await page.locator('[data-testid=deleted-note], .alert').allTextContents());
await page.click('[data-testid=remove-tree]');
console.log(await page.locator('[data-testid=remove-ask]').textContent());
await page.click('[data-testid=remove-ok]');
await page.waitForTimeout(1000);
await dump('NEW-after-delete1');
await page.click('.tab:has-text("一覧")');
console.log('cards', await cards.count());
if (await cards.count()) {
  await cards.first().click();
  console.log('opened no=', await page.inputValue('#f-treeNo'), 'species=', await page.inputValue('#f-species'), 'h=', await page.inputValue('#f-height'));
}
await ctx.close(); server.close();
