// 詳しい診断の記録を作った後に、簡易診断で枯れ枝の本数を入れた → 詳しい診断の画面で知らせ、「写す」で写す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('記録を作った後に簡易診断で足した寸法（枯れ枝の本数）を、詳しい診断の画面で写せる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('ml-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('ml-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  // 簡易診断：AB002 を「必要」にして保存 → 続けて詳しい診断を開く（記録ができる）
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '10');
  await page.fill('#f-girth0', '0.5');
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');
  await page.click('[data-testid=initial-prompt-go]');
  await expect(page.locator('[data-testid=initial-tree]')).toContainText('AB002');
  await expect(page.locator('[data-testid=measures-pending]')).toHaveCount(0);

  // 簡易診断に戻って、枯れ枝「有」・本数を入れる
  await page.click('[data-testid=back-to-simple]');
  await page.click('[data-group=deadBranch] [data-v="有"]');
  await page.fill('#f-deadBranchCount', '3');
  await page.click('[data-testid=save-stay]');
  await page.click('[data-testid=open-initial]');

  // 知らせ → 写す
  await expect(page.locator('[data-testid=measures-pending]')).toContainText('枯れ枝');
  await page.click('[data-testid=measures-apply]');
  await expect(page.locator('[data-testid=measures-pending]')).toHaveCount(0);
  await expect(page.locator('#i-b4Detail')).toHaveValue('3本');
});
