// 一度開いたアプリは、電波がなくても開ける（サービスワーカー）。入力も端末に残る
import { expect, test } from '@playwright/test';

test('一度開けば、電波なしでも開けて、入力した内容も残っている', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready; // オフライン用の準備が終わるまで待つ
  });
  await page.reload(); // 2回目からはサービスワーカーが部品を保存する
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.waitForTimeout(600); // 端末への保存を待つ

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#s-insp')).toHaveValue('試験 二郎(資格)');
  await expect(page.locator('footer')).toContainText('Koh Kitsukawa');
});

test('ホーム画面に追加するための情報（マニフェスト）がある', async ({ page }) => {
  const res = await page.request.get('./manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.length).toBeGreaterThan(0);
});
