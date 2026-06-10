import { test, expect } from "@playwright/test";

/**
 * 予約状況ストリップ の E2E テスト。
 * デモ基準日 TODAY = new Date(2026,5,3) = 2026年6月3日 なので
 * 今月＋先3ヶ月は 2026/06, 2026/07, 2026/08, 2026/09（左から現在→未来順）。
 */
async function disableFSA(page) {
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
}

// 行ヘルパー
function row(play, g, p, kk = "") {
  return { n: "幹事", play, g, p, kk, wd: "", course: "", time: "", route: "" };
}

// ---- フィクスチャ: 今月＋先3ヶ月（TODAY=2026/06）にまたがるデータ ----
// 2026/06（今月）: コンペ3件（人数 8+12+16=36）
// 2026/07（1ヶ月先）: コンペ1件（人数 20）
// 2026/08（2ヶ月先）: キャンセル1件のみ → 0件
// 2026/09（3ヶ月先）: コンペ2件（人数 12+16=28）
// 2026/01: 対象外（ストリップには出ない過去月）
const FIX_STRIP = {
  schemaVersion: 1,
  rows: [
    row("2026/06/01", 2, 8),
    row("2026/06/02", 3, 12),
    row("2026/06/03", 4, 16),
    row("2026/07/05", 5, 20),
    row("2026/08/15", 7, 28, "キャンセル"),
    row("2026/09/10", 3, 12),
    row("2026/09/25", 4, 16),
    row("2026/01/10", 3, 12), // 対象外（過去月）
  ],
};

async function openMain(page, fixture) {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");
  await page.evaluate((fx) => {
    window.applyJson(fx);
    window.setMode(true); // render() を呼ぶ → renderStrip() も走る
  }, fixture);
  await expect(page.locator("#screenMain")).not.toHaveClass(/hidden/);
}

// ============================================================
// 表示順・件数・人数のテスト
// ============================================================

test("ストリップに「予約状況」ラベルと4つの月アイテムが表示される", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  // ラベル
  await expect(page.locator("#monthStrip .strip-label")).toContainText("予約状況");

  // 月アイテムが4つ
  const items = page.locator("#monthStrip .strip-item");
  await expect(items).toHaveCount(4);
});

test("4月アイテムが今月から先3ヶ月の順（6・7・8・9月）で表示される", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const items = page.locator("#monthStrip .strip-item");

  // 左から: 今月(6月), 1ヶ月先(7月), 2ヶ月先(8月), 3ヶ月先(9月)
  await expect(items.nth(0)).toContainText("6月");
  await expect(items.nth(1)).toContainText("7月");
  await expect(items.nth(2)).toContainText("8月");
  await expect(items.nth(3)).toContainText("9月");
});

test("各月アイテムの件数・人数が正しい", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const items = page.locator("#monthStrip .strip-item");

  // 6月（今月）: 3件・36人
  await expect(items.nth(0)).toContainText("3件");
  await expect(items.nth(0)).toContainText("36人");

  // 7月: 1件・20人
  await expect(items.nth(1)).toContainText("1件");
  await expect(items.nth(1)).toContainText("20人");

  // 8月: キャンセルのみ → 0件（「・0人」は省く）
  await expect(items.nth(2)).toContainText("0件");
  await expect(items.nth(2)).not.toContainText("人");

  // 9月: 2件・28人
  await expect(items.nth(3)).toContainText("2件");
  await expect(items.nth(3)).toContainText("28人");
});

test("今月アイテムだけ .current クラスを持つ（太字強調）", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const items = page.locator("#monthStrip .strip-item");

  await expect(items.nth(0)).toHaveClass(/current/);
  await expect(items.nth(1)).not.toHaveClass(/current/);
  await expect(items.nth(2)).not.toHaveClass(/current/);
  await expect(items.nth(3)).not.toHaveClass(/current/);
});

test("データが全くない月は 0件 と表示される", async ({ page }) => {
  await openMain(page, { schemaVersion: 1, rows: [] });

  const items = page.locator("#monthStrip .strip-item");
  await expect(items).toHaveCount(4);
  // 全アイテムが 0件
  for (let i = 0; i < 4; i++) {
    await expect(items.nth(i)).toContainText("0件");
    await expect(items.nth(i)).not.toContainText("人");
  }
});

// ============================================================
// クリック不能（表示専用）のテスト
// ============================================================

test("月アイテムはクリック不能（onclick なし・button でない）", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const items = page.locator("#monthStrip .strip-item");
  const count = await items.count();
  expect(count).toBe(4);

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    // button 要素ではない
    const tagName = await item.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).not.toBe("button");
    // onclick 属性がない
    const onclick = await item.getAttribute("onclick");
    expect(onclick).toBeNull();
  }
});

// ============================================================
// 「詳細 →」リンク
// ============================================================

test("「詳細 →」クリックで集計画面に遷移する", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const link = page.locator("#monthStrip .strip-link");
  await expect(link).toContainText("詳細");
  await link.click();

  await expect(page.locator("#screenStats")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);
});

test("ストリップはメイン画面でのみ表示される（stats画面では隠れる）", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  // メイン画面では strip が含まれる screenMain が表示されている
  await expect(page.locator("#screenMain")).not.toHaveClass(/hidden/);
  await expect(page.locator("#monthStrip")).toBeVisible();

  // 集計画面へ遷移 → screenMain が hidden になりストリップも非表示
  await page.locator("#toStats").click();
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);
  await expect(page.locator("#monthStrip")).not.toBeVisible();
});

// ============================================================
// 年またぎ表示のテスト（TODAY=2026/11 を想定した仮設シナリオ）
// ============================================================

test("年またぎ月には年プレフィックスが付く（11月基準なら 27/1月・27/2月）", async ({ page }) => {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");

  // TODAY を 2026年11月にオーバーライドしてストリップを再描画
  await page.evaluate(() => {
    window.TODAY = new Date(2026, 10, 1); // 2026/11/01
    window.renderStrip();
  });

  // 再描画後に strip-item が 11月を含むまで待つ
  const items = page.locator("#monthStrip .strip-item");
  await expect(items.nth(0)).toContainText("11月", { timeout: 5000 });
  await expect(items).toHaveCount(4);

  // 11月・12月は年なし、翌年1月・2月は「27/1月」「27/2月」
  await expect(items.nth(1)).toContainText("12月");
  await expect(items.nth(2)).toContainText("27/1月");
  await expect(items.nth(3)).toContainText("27/2月");
});

// ============================================================
// 報告用スクリーンショット
// ============================================================

test("ストリップを含むメイン画面のスクリーンショットを保存", async ({ page }) => {
  await openMain(page, FIX_STRIP);
  await page.screenshot({
    path: "test-results/strip-screen.png",
    fullPage: true,
  });
});
