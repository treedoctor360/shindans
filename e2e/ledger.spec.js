// 台帳で調査済みの木：「調べ直す」は押す前に確かめ、押した後も取り消せる（押し間違いで台帳の値を下書きにしてしまわないように）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('調べ直すボタン：確かめる → やめる／する → 取り消す', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/l-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/l-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await expect(page.locator('#f-height')).toBeDisabled(); // 台帳の値は直せない
  await expect(page.locator('[data-alert=ledgerDone]')).toContainText('台帳ですでに調査済み');

  // 押すと、まず確かめる。「やめる」なら何も変わらない
  await page.click('text=調べ直す（再調査として入力する）');
  await expect(page.locator('[data-testid=confirm-act]')).toContainText('よろしいですか');
  await page.click('[data-testid=confirm-no]');
  await expect(page.locator('[data-testid=confirm-act]')).toHaveCount(0);
  await expect(page.locator('#f-height')).toBeDisabled();

  // 「する」と入力できるようになる。取り消すと元に戻る
  await page.click('text=調べ直す（再調査として入力する）');
  await page.click('[data-testid=confirm-yes]');
  await expect(page.locator('#f-height')).toBeEnabled();
  await expect(page.locator('#f-height')).toHaveValue('8.5'); // 台帳の値が下書き
  await page.click('[data-testid=undo-btn]');
  await expect(page.locator('#f-height')).toBeDisabled();
  await expect(page.locator('[data-alert=ledgerDone]')).toBeVisible();
});
