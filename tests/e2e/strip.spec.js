import { test, expect } from "@playwright/test";

/**
 * 直近4ヶ月ストリップ の E2E テスト。
 * デモ基準日 TODAY = new Date(2026,5,3) = 2026年6月3日 なので
 * 直近4ヶ月は 2026/03, 2026/04, 2026/05, 2026/06（左から古い順）。
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

// ---- フィクスチャ: 直近4ヶ月（TODAY=2026/06）にまたがるデータ ----
// 2026/03: コンペ2件
// 2026/04: コンペ1件
// 2026/05: キャンセル1件のみ → 0件
// 2026/06: コンペ3件
// 2026/01: 対象外（3ヶ月より古い）
const FIX_STRIP = {
  schemaVersion: 1,
  rows: [
    row("2026/03/10", 3, 12),
    row("2026/03/25", 4, 16),
    row("2026/04/05", 5, 20),
    row("2026/05/15", 7, 28, "キャンセル"),
    row("2026/06/01", 2, 8),
    row("2026/06/02", 3, 12),
    row("2026/06/03", 4, 16),
    row("2026/01/10", 3, 12), // 対象外
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

test("ストリップに4チップが表示される", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const chips = page.locator("#monthStrip .strip-chip");
  await expect(chips).toHaveCount(4);
});

test("各チップの月ラベルと件数が正しい（データあり・0件・今月強調）", async ({
  page,
}) => {
  await openMain(page, FIX_STRIP);

  const chips = page.locator("#monthStrip .strip-chip");

  // 3月: 2件（キャンセル除外）
  await expect(chips.nth(0)).toContainText("3月");
  await expect(chips.nth(0)).toContainText("2件");

  // 4月: 1件
  await expect(chips.nth(1)).toContainText("4月");
  await expect(chips.nth(1)).toContainText("1件");

  // 5月: キャンセルのみ → 0件
  await expect(chips.nth(2)).toContainText("5月");
  await expect(chips.nth(2)).toContainText("0件");

  // 6月（今月）: 3件
  await expect(chips.nth(3)).toContainText("6月");
  await expect(chips.nth(3)).toContainText("3件");

  // 今月チップだけ .current クラスを持つ
  await expect(chips.nth(3)).toHaveClass(/current/);
  await expect(chips.nth(0)).not.toHaveClass(/current/);
  await expect(chips.nth(1)).not.toHaveClass(/current/);
  await expect(chips.nth(2)).not.toHaveClass(/current/);
});

test("データが全くない月は 0件 と表示される", async ({ page }) => {
  await openMain(page, { schemaVersion: 1, rows: [] });

  const chips = page.locator("#monthStrip .strip-chip");
  await expect(chips).toHaveCount(4);
  // 全チップが 0件
  for (let i = 0; i < 4; i++) {
    await expect(chips.nth(i)).toContainText("0件");
  }
});

test("「詳細 →」クリックで集計画面に遷移する", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const link = page.locator("#monthStrip .strip-link");
  await expect(link).toContainText("詳細");
  await link.click();

  await expect(page.locator("#screenStats")).not.toHaveClass(/hidden/);
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);
});

test("ストリップはメイン画面でのみ表示される（stats画面では隠れる）", async ({
  page,
}) => {
  await openMain(page, FIX_STRIP);

  // メイン画面では strip が含まれる screenMain が表示されている
  await expect(page.locator("#screenMain")).not.toHaveClass(/hidden/);
  await expect(page.locator("#monthStrip")).toBeVisible();

  // 集計画面へ遷移 → screenMain が hidden になりストリップも非表示
  await page.locator("#toStats").click();
  await expect(page.locator("#screenMain")).toHaveClass(/hidden/);
  await expect(page.locator("#monthStrip")).not.toBeVisible();
});

// 報告用スクリーンショット（assert なし）
test("ストリップを含むメイン画面のスクリーンショットを保存", async ({
  page,
}) => {
  await openMain(page, FIX_STRIP);
  await page.screenshot({
    path: "test-results/strip-screen.png",
    fullPage: true,
  });
});
