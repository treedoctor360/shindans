// デスクトップ表示：広い画面だけ上の帯にボタンを出し、押すと一覧・簡易診断・詳しい診断を横に並べる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  return p;
};

const setup = async (page) => {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], items: ['b4'] }];
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', tmp('dk-config.json', JSON.stringify(cfg)));
  await page.setInputFiles('[data-testid=ledger-file]', tmp('dk-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('dk-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();
};

test('スマホの幅ではボタンを出さない', async ({ page }) => {
  await setup(page);
  await expect(page.locator('[data-testid=desktop-toggle]')).toHaveCount(0);
});

test.describe('広い画面', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('ボタンで切り替え、簡易診断と詳しい診断を並べる。端末に覚え、狭くすると今までの表示に戻る', async ({ page }) => {
    await setup(page);
    const toggle = page.locator('[data-testid=desktop-toggle]');
    await expect(toggle).toBeVisible();
    await page.click('.tab:has-text("一覧")');
    // 初めはオフ（今までの表示）
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const split = page.locator('[data-testid=desktop-split]');
    await expect(split.locator('.pane-empty')).toBeVisible();

    // 左の一覧から木を選ぶと、中に簡易診断
    await split.locator('.pane-l [data-tree=AB002]').click();
    const simple = split.locator('[data-testid=pane-simple]');
    await expect(simple.locator('#f-height')).toBeVisible();
    await expect(split.locator('.pane-l [data-tree=AB002]')).toHaveClass(/sel/);
    await simple.locator('#f-height').fill('10');
    await simple.locator('#f-girth0').fill('0.5');
    await simple.locator('[data-testid=note-chips] >> text=根元の割れ').click();
    await simple.locator('[data-group=initialNeeded] [data-v="要"]').click();
    await simple.locator('text=保存して次の木へ').click();
    await page.click('text=未入力のまま保存する');
    await page.click('[data-testid=initial-prompt-go]');
    // 右に詳しい診断、中は同じ木の簡易診断
    const initial = split.locator('[data-testid=pane-initial]');
    await expect(initial.locator('[data-testid=simple-notes]')).toContainText('根元の割れ');
    await expect(initial.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
    await expect(simple.locator('#f-height')).toHaveValue('10');

    // 詳しい診断の記録がない木では、右の列を出さない
    await split.locator('.pane-l [data-tree=AB003]').click();
    await expect(simple.locator('#f-height')).toBeVisible();
    await expect(initial.locator('[data-testid=initial-view]')).toHaveCount(0);
    await split.locator('.pane-l [data-tree=AB002]').click();
    await expect(initial.locator('[data-testid=initial-view]')).toBeVisible();

    // 開き直してもオンのまま
    await page.reload();
    await expect(page.locator('[data-testid=desktop-toggle]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid=desktop-split]')).toBeVisible();

    // 狭くすると今までの表示（ボタンも出さない）、広げると戻る
    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
    await expect(page.locator('[data-testid=desktop-toggle]')).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator('[data-testid=desktop-split]')).toBeVisible();

    // オフに戻す
    await page.locator('[data-testid=desktop-toggle]').click();
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
  });
});
