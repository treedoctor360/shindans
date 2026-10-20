// 調査日をまとめて直す：設定の調査日を間違えて保存した木を、一覧画面からまとめて直す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('間違えた日付の木だけ、調査日を直す（調査者は変えない）', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/rd-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06'); // 間違えた日付
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/rd-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-testid=save-stay]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('AB002 を保存しました');

  await page.click('.tab:has-text("一覧")');
  await page.click('[data-testid=redate-open]');
  await page.selectOption('[data-testid=redate-from]', '2099-05-06');
  await expect(page.locator('[data-testid=redate-preview]')).toContainText('直す木：1本（AB002）');
  await expect(page.locator('[data-testid=redate-run]')).toBeDisabled();
  await page.fill('[data-testid=redate-to]', '2099-05-05');
  await page.click('[data-testid=redate-run]');
  await expect(page.locator('.toast')).toContainText('調査日を 2099/05/06 → 2099/05/05 に直しました（1本）');

  const saved = await page.evaluate(
    () =>
      new Promise((ok) => {
        const req = indexedDB.open('shindans');
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, 'readonly');
          const out = [];
          let left = names.length;
          for (const n of names) {
            const all = tx.objectStore(n).getAll();
            all.onsuccess = () => {
              out.push(JSON.stringify(all.result));
              if (--left === 0) ok(out.join('\n'));
            };
          }
        };
      }),
  );
  // 端末に保存された AB002 の記録：調査日だけが変わり、調査者はそのまま
  expect(saved).toMatch(/"treeNo":"AB002"[^{}]*"date":"2099-05-05","inspector":"試験 二郎\(資格\)"/);
  // 直した後は、直す木がなくなる
  await page.click('[data-testid=redate-open]');
  await page.selectOption('[data-testid=redate-from]', '2099-05-05');
  await expect(page.locator('[data-testid=redate-preview]')).toContainText('直す木：1本（AB002）');
});
