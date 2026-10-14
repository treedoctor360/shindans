// 前回の調査（カルテ）：事務所の PC でまとめて読み込み → サーバーに置く → スマホで受け取り、入力画面で弱点と写真を見る
// サーバーは「にせの Google」（test/helpers/fakeGas.js）。カルテは架空のもの
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeKarte } from '../test/helpers/makeKarte.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const URL_ = 'https://example.invalid/macros/s/xxx/exec';
const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};
async function connect(page, gas) {
  await page.route(`${URL_}*`, async (route) => {
    const res = await gas.fetchFn(URL_, { body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await res.json()) });
  });
}
async function setServer(page) {
  await page.fill('#s-url', URL_);
  await page.fill('#s-pass', 'ひみつ');
}

test('PC でカルテをまとめて読み込み、スマホで前回の弱点と写真を見る', async ({ browser }) => {
  const gas = makeFakeGas();

  // 事務所の PC：設定・台帳・カルテ（2ファイル）を読み込んで、サーバーに置く
  const pc = await (await browser.newContext()).newPage();
  await connect(pc, gas);
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await pc.setInputFiles('[data-testid=ledger-file]', tmp('p-ledger.xlsx', await makeLedger()));
  await expect(pc.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await pc.setInputFiles('[data-testid=prev-files]', [
    tmp('p-karte1.xlsx', await makeKarte()),
    tmp('p-karte2.xlsx', await makeKarte([{ no: 'AB001', code: 'K09', place: '別の架空公園', species: 'ちがう木' }])),
  ]);
  await expect(pc.locator('.toast')).toContainText('2ファイルから3本分を読み込みました（写真4枚）');
  await expect(pc.locator('[data-testid=prev-status]')).toContainText('3本・2か所');
  await setServer(pc);
  await pc.click('[data-testid=server-put]');
  await expect(pc.locator('.toast')).toContainText('前回の調査3本');

  // スマホ：受け取る（写真はまだ入らない）
  const phone = await (await browser.newContext()).newPage();
  await connect(phone, gas);
  await phone.goto('./');
  await setServer(phone);
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('前回の調査（3本）');

  // 一覧に印が出る。開くと弱点と評価が見える
  await phone.click('.tab:has-text("一覧")');
  await expect(phone.locator('[data-tree=AB001] .tag.prev')).toBeVisible();
  await expect(phone.locator('[data-tree=AB003] .tag.prev')).toHaveCount(0);
  await phone.click('[data-tree=AB001]');
  await expect(phone.locator('[data-testid=prev-open]')).toContainText('2090/09/01・弱点3・写真2枚'); // 閉じたままでも分かる
  await phone.click('[data-testid=prev-open]');
  await expect(phone.locator('[data-testid=prev-items] li')).toHaveCount(3);
  await expect(phone.locator('[data-testid=prev-items]')).toContainText('幹 ①うろ 有（大）');
  await expect(phone.locator('[data-testid=prev]')).toContainText('危険度 E うろ・根の傷み');

  // 写真：この場所の分を端末に入れると見られる。タップで大きく
  await phone.click('[data-testid=prev-get-photos]');
  await expect(phone.locator('[data-testid=prev-photos] img')).toHaveCount(2);
  await phone.locator('.prev-photo').first().click();
  await expect(phone.locator('.photo-big img')).toBeVisible();
  await phone.click('.photo-big');
  await expect(phone.locator('.photo-big')).toHaveCount(0);

  // 樹種が違う木は、中身を隠して知らせる（番号の付け替えで別の木かもしれないので）
  await phone.click('.tab:has-text("一覧")');
  const other = await phone.locator('#s-group option', { hasText: '別の架空公園' }).getAttribute('value');
  await phone.selectOption('#s-group', other);
  await phone.click('[data-tree=AB001]');
  await phone.click('[data-testid=prev-open]');
  await expect(phone.locator('[data-testid=prev-mismatch]')).toBeVisible();
  await expect(phone.locator('[data-testid=prev-items]')).toHaveCount(0);
  await phone.click('text=それでも表示する');
  await expect(phone.locator('[data-testid=prev-items]')).toBeVisible();
});
