import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/dummy-ledger.json"), "utf-8")
);

/**
 * FSA（File System Access API）をページロード前に無効化するヘルパー。
 * index.html は `const FSA_SUPPORTED = !!(window.showOpenFilePicker && ...)` で評価するため、
 * addInitScript で削除すると FSA_SUPPORTED=false になり、
 * fileHandle=null でも接続CTAが出ずに通常の一覧描画に進む。
 * これにより applyJson でダミーデータを注入したあとの描画テストが可能になる。
 */
async function disableFSA(page) {
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
}

// (a) index.html がコンソールエラーなしでロードされる
test("コンソールエラーなしでロードされる", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/index.html");
  // DOMが安定するまで待つ
  await page.waitForLoadState("domcontentloaded");
  // xlsx.full.min.js のロードを含む networkidle を待つ
  await page.waitForLoadState("networkidle");

  expect(pageErrors, `ページエラー: ${pageErrors.join("\n")}`).toHaveLength(0);
});

// (b) applyJson でダミーデータを注入 → 一覧に行が描画される
test("applyJson でダミーデータを注入すると一覧に行が表示される", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");

  // applyJson を呼んでデータを注入し、全件モードへ切り替え
  await page.evaluate((fixture) => {
    window.applyJson(fixture);
    window.setMode(true); // 全件表示
  }, FIXTURE);

  // .gi（行アイテム）が描画されていることを確認
  const items = page.locator("#list .gi");
  await expect(items).toHaveCount(FIXTURE.rows.length);

  expect(pageErrors).toHaveLength(0);
});

// (c) 「全件」「今日」モード切替が動く
test("今日やること / 全件 モード切替が動く", async ({ page }) => {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");

  await page.evaluate((fixture) => {
    window.applyJson(fixture);
    window.setMode(true);
  }, FIXTURE);

  // 「全件」ボタンが .on になっている
  await expect(page.locator("#segAll")).toHaveClass(/on/);
  await expect(page.locator("#segToday")).not.toHaveClass(/on/);

  // 「今日やること」ボタンをクリック
  await page.locator("#segToday").click();
  await expect(page.locator("#segToday")).toHaveClass(/on/);
  await expect(page.locator("#segAll")).not.toHaveClass(/on/);

  // countLbl が「今日やること：N件」形式になっている
  await expect(page.locator("#countLbl")).toContainText("今日やること");

  // 「全件」ボタンをクリックして戻す
  await page.locator("#segAll").click();
  await expect(page.locator("#countLbl")).toContainText("全件");
});

// (d) 検索ボックス入力で絞り込みが動く
test("検索ボックスで氏名絞り込みが動く", async ({ page }) => {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");

  await page.evaluate((fixture) => {
    window.applyJson(fixture);
    window.setMode(true);
  }, FIXTURE);

  // 全件表示されていることを確認
  await expect(page.locator("#list .gi")).toHaveCount(FIXTURE.rows.length);

  // 検索ボックスに架空太郎を入力
  await page.locator("#searchBox").fill("架空太郎");
  // 1件のみに絞り込まれる
  await expect(page.locator("#list .gi")).toHaveCount(1);
  await expect(page.locator("#list .gi .nm")).toContainText("架空太郎");

  // 検索クリアで全件に戻る
  await page.locator("#searchBox").fill("");
  await expect(page.locator("#list .gi")).toHaveCount(FIXTURE.rows.length);
});

// (e) 設定画面・SMS画面への遷移と一覧への復帰が動く
test("設定画面 / SMS画面 への遷移と一覧への復帰が動く", async ({ page }) => {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");

  await page.evaluate((fixture) => {
    window.applyJson(fixture);
  }, FIXTURE);

  // --- 設定画面へ遷移 ---
  await page.locator("#toSettings").click();
  // screenSettings が表示され、screenMain が非表示になる
  await expect(page.locator("#screenSettings")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);
  // 「← 一覧へ戻る」ボタンが表示されている
  await expect(page.locator("#toMain")).not.toHaveClass(/hidden/);

  // 一覧へ戻る
  await page.locator("#toMain").click();
  await expect(page.locator("#screenMain")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenSettings")).toHaveClass(/hidden/);

  // --- SMS配信リスト画面へ遷移 ---
  await page.locator("#toSms").click();
  await expect(page.locator("#screenSms")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);

  // 一覧へ戻る
  await page.locator("#toMain").click();
  await expect(page.locator("#screenMain")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenSms")).toHaveClass(/hidden/);
});
