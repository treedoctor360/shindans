// 詳しい診断の画面：数・1行の文字は2列、選択肢は1行に詰める。枝下高などは空欄なら保存時に「-」
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('2列に並び、空欄の枝下高は保存すると「-」になる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('c-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');

  // 樹高・幹周・枝下高は同じ2列のまとまりに入る。選択肢は見出しとボタンが1行
  await expect(page.locator('.grid2 [data-item=height]')).toBeVisible();
  await expect(page.locator('.grid2 [data-item=clearWalk]')).toBeVisible();
  const h = await page.locator('[data-item=height]').boundingBox();
  const g = await page.locator('[data-item=girth]').boundingBox();
  expect(Math.abs(h.y - g.y)).toBeLessThan(2); // 横に並ぶ
  const lean = page.locator('[data-item=lean]');
  const lb = await lean.locator('.lbl').boundingBox();
  const bb = await lean.locator('.seg').boundingBox();
  expect(bb.x).toBeGreaterThan(lb.x + lb.width - 1); // ボタンは見出しの右

  // 枝下高：数のキーボード・単位 m・空欄なら「-」
  await expect(page.locator('#i-clearWalk')).toHaveAttribute('inputmode', 'decimal');
  await expect(page.locator('[data-item=clearWalk] .unit span')).toHaveText('m');
  await expect(page.locator('#i-clearWalk')).toHaveAttribute('placeholder', '空欄なら -');
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('#i-clearWalk')).toHaveValue('-');
});
