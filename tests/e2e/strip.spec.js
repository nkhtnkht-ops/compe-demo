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

// 名前付き行ヘルパー（月絞り込みの assert 用）
function namedRow(name, play, g, p, kk = "") {
  return { n: name, play, g, p, kk, wd: "", course: "", time: "", route: "" };
}

// ---- フィクスチャ: 直近4ヶ月（TODAY=2026/06）にまたがるデータ ----
// 2026/03: コンペ2件（人数 12+16=28）
// 2026/04: コンペ1件（人数 20）
// 2026/05: キャンセル1件のみ → 0件
// 2026/06: コンペ3件（人数 8+12+16=36）
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

// ---- フィクスチャ: 月絞り込みの assert 用（氏名を分けて検索テストにも使う） ----
const FIX_NAMED = {
  schemaVersion: 1,
  rows: [
    namedRow("田中三月A", "2026/03/10", 3, 12),
    namedRow("田中三月B", "2026/03/25", 4, 16),
    namedRow("鈴木四月",  "2026/04/05", 5, 20),
    namedRow("佐藤五月",  "2026/05/15", 7, 28, "キャンセル"), // キャンセル
    namedRow("山田六月A", "2026/06/01", 2, 8),
    namedRow("山田六月B", "2026/06/02", 3, 12),
    namedRow("山田六月C", "2026/06/03", 4, 16),
    namedRow("対象外",    "2026/01/10", 3, 12),
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
// 既存テスト（文言を新フォーマットに合わせて更新）
// ============================================================

test("ストリップに4チップが表示される", async ({ page }) => {
  await openMain(page, FIX_STRIP);

  const chips = page.locator("#monthStrip .strip-chip");
  await expect(chips).toHaveCount(4);
});

test("各チップの月ラベルと件数・人数が正しい（データあり・0件・今月強調）", async ({
  page,
}) => {
  await openMain(page, FIX_STRIP);

  const chips = page.locator("#monthStrip .strip-chip");

  // 3月: 2件・28人
  await expect(chips.nth(0)).toContainText("3月");
  await expect(chips.nth(0)).toContainText("2件");
  await expect(chips.nth(0)).toContainText("28人");

  // 4月: 1件・20人
  await expect(chips.nth(1)).toContainText("4月");
  await expect(chips.nth(1)).toContainText("1件");
  await expect(chips.nth(1)).toContainText("20人");

  // 5月: キャンセルのみ → 0件（「・0人」は省く）
  await expect(chips.nth(2)).toContainText("5月");
  await expect(chips.nth(2)).toContainText("0件");
  await expect(chips.nth(2)).not.toContainText("人");

  // 6月（今月）: 3件・36人
  await expect(chips.nth(3)).toContainText("6月");
  await expect(chips.nth(3)).toContainText("3件");
  await expect(chips.nth(3)).toContainText("36人");

  // 今月チップだけ .current クラスを持つ（黒背景ではなく太字+濃い枠線）
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
    await expect(chips.nth(i)).not.toContainText("人");
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

// ============================================================
// 新規テスト A: チップクリックで月絞り込み
// ============================================================

test("チップクリック → 一覧がその月のプレー日の行だけになる", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 3月チップをクリック
  await chips.nth(0).click();

  // 3月のコンペ行のみ（2件）
  const items = page.locator("#list .gi");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator(".nm")).toContainText("田中三月");
  await expect(items.nth(1).locator(".nm")).toContainText("田中三月");

  // ヘッダラベルが「3月プレー分：2件」
  await expect(page.locator("#countLbl")).toContainText("3月プレー分");
  await expect(page.locator("#countLbl")).toContainText("2件");
});

test("チップクリック → 6月絞り込みでヘッダラベルが「6月プレー分：3件」", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 6月チップ（nth(3)）をクリック
  await chips.nth(3).click();

  const items = page.locator("#list .gi");
  await expect(items).toHaveCount(3);

  await expect(page.locator("#countLbl")).toContainText("6月プレー分");
  await expect(page.locator("#countLbl")).toContainText("3件");
});

test("5月（0件）チップクリック → 一覧が空になる（キャンセルは除外）", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 5月チップ（nth(2)）をクリック
  await chips.nth(2).click();

  // コンペ行は 0（キャンセルはvisibleRowsに含まれるが fullRow表示される）
  // visibleRows は play 日が5月の全行→キャンセル行1件
  const items = page.locator("#list .gi");
  await expect(items).toHaveCount(1); // キャンセル行 1 件は表示される
  await expect(page.locator("#countLbl")).toContainText("5月プレー分");
  await expect(page.locator("#countLbl")).toContainText("1件");
});

test("絞り込み有効チップには .filtered クラスと「×」が表示される", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");
  await chips.nth(0).click(); // 3月を絞り込み

  // 3月チップが .filtered に
  await expect(chips.nth(0)).toHaveClass(/filtered/);
  await expect(chips.nth(0)).toContainText("×");
  // 他は filtered でない
  await expect(chips.nth(1)).not.toHaveClass(/filtered/);
  await expect(chips.nth(2)).not.toHaveClass(/filtered/);
  await expect(chips.nth(3)).not.toHaveClass(/filtered/);
});

test("絞り込み有効チップを再クリックで解除 → 元の全件表示に戻る", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 3月チップをクリックして絞り込み
  await chips.nth(0).click();
  await expect(chips.nth(0)).toHaveClass(/filtered/);
  await expect(page.locator("#list .gi")).toHaveCount(2);

  // 再クリックで解除
  await chips.nth(0).click();
  await expect(chips.nth(0)).not.toHaveClass(/filtered/);

  // 全件（今月含む8行、ただし setMode(true)=全件モードなので対象外の対象外行も含む）
  // FIX_NAMED は 8行（キャンセル含む）
  await expect(page.locator("#list .gi")).toHaveCount(8);
  await expect(page.locator("#countLbl")).toContainText("全件");
});

test("絞り込み中に検索すると月内AND検索になる", async ({ page }) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 6月チップをクリック（3件: 山田六月A/B/C）
  await chips.nth(3).click();
  await expect(page.locator("#list .gi")).toHaveCount(3);

  // 「山田六月A」で検索 → 6月内のみ絞り込み → 1件
  await page.locator("#searchBox").fill("山田六月A");
  await expect(page.locator("#list .gi")).toHaveCount(1);
  await expect(page.locator("#list .gi .nm")).toContainText("山田六月A");

  // ヘッダラベルは「6月プレー分：1件」のまま（検索プレフィックスではない）
  await expect(page.locator("#countLbl")).toContainText("6月プレー分");
  await expect(page.locator("#countLbl")).toContainText("1件");
});

test("絞り込み中に「全部」(コンタクト) を押すと解除される", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 3月に絞り込み
  await chips.nth(0).click();
  await expect(page.locator("#list .gi")).toHaveCount(2);
  await expect(chips.nth(0)).toHaveClass(/filtered/);

  // コンタクト「全部」ボタンをクリック
  await page.locator("#cfAll").click();

  // monthFilter が解除され全件に戻る
  await expect(chips.nth(0)).not.toHaveClass(/filtered/);
  await expect(page.locator("#list .gi")).toHaveCount(8);
  await expect(page.locator("#countLbl")).toContainText("全件");
});

test("絞り込み中にモード切替（今日やること）を押すと解除される", async ({
  page,
}) => {
  await openMain(page, FIX_NAMED);

  const chips = page.locator("#monthStrip .strip-chip");

  // 6月に絞り込み
  await chips.nth(3).click();
  await expect(chips.nth(3)).toHaveClass(/filtered/);

  // 「今日やること」セグメントをクリック
  await page.locator("#segToday").click();

  // monthFilter が解除される
  await expect(chips.nth(3)).not.toHaveClass(/filtered/);
  // 「今日やること」モードになっている
  await expect(page.locator("#countLbl")).toContainText("今日やること");
});

// ============================================================
// 報告用スクリーンショット
// ============================================================

test("ストリップを含むメイン画面のスクリーンショットを保存", async ({
  page,
}) => {
  await openMain(page, FIX_STRIP);
  await page.screenshot({
    path: "test-results/strip-screen.png",
    fullPage: true,
  });
});

test("絞り込み有効状態のスクリーンショットを保存", async ({ page }) => {
  await openMain(page, FIX_NAMED);

  // 6月チップをクリックして絞り込み状態にする
  const chips = page.locator("#monthStrip .strip-chip");
  await chips.nth(3).click();
  await expect(chips.nth(3)).toHaveClass(/filtered/);

  await page.screenshot({
    path: "test-results/strip-filter-screen.png",
    fullPage: true,
  });
});
