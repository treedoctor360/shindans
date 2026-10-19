// 入力画面で下へスクロールしても、樹木番号と樹種が画面の上に見えている
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('入力画面：スクロールしても樹木番号と樹種が上に残る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/tb-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/tb-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.fill('#f-species', 'テストノキ');
  await expect(page.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
  await expect(page.locator('[data-testid=tree-bar-species]')).toHaveText('テストノキ');

  // 一番下の特記事項までスクロールしても、帯は上の帯（表題）のすぐ下に見えている
  await page.locator('#f-notes').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 3000);
  const top = await page.locator('.top').boundingBox();
  const bar = await page.locator('[data-testid=tree-bar]').boundingBox();
  expect(Math.abs(bar.y - (top.y + top.height))).toBeLessThan(2);
  await expect(page.locator('[data-testid=tree-bar-no]')).toBeInViewport();
});
