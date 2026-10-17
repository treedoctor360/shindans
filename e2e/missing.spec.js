// 選んだ木が見つからないとき、別の木を黙って開かない（別の木を書き換える事故の再発防止）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('【再発防止】選んだ木が見つからなければ、最初の木を開かずに止めて知らせる。調べるためのデータを書き出せる', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/m-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/m-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.waitForTimeout(500);

  // 端末の状態を「見つからない木を選んで入力画面」にして開き直す
  await page.evaluate(
    () =>
      new Promise((ok) => {
        const rq = indexedDB.open('shindans');
        rq.onsuccess = () => {
          const db = rq.result;
          const store = db.objectStoreNames[0];
          const tx = db.transaction(store, 'readwrite');
          const os = tx.objectStore(store);
          const g = os.get('state');
          g.onsuccess = () => os.put({ ...g.result, currentId: 'みつからない木', view: 'form' }, 'state');
          tx.oncomplete = () => ok();
        };
      }),
  );
  await page.reload();
  await expect(page.locator('[data-testid=tree-missing]')).toBeVisible();
  await expect(page.locator('#f-treeNo')).toHaveCount(0); // 別の木の入力画面は出さない
  await page.click('[data-testid=back-to-list]');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();

  // 調べるためのデータ
  await page.click('.tab:has-text("設定")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=diagnostic]')]);
  const d = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(d.kind).toBe('shindans-diagnostic');
  expect(d.state.trees.length).toBeGreaterThan(0);
});
