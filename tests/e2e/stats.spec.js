import { test, expect } from "@playwright/test";

/**
 * 月別集計（集計画面）の E2E テスト。
 * smoke.spec.js と同じく FSA（File System Access API）を無効化して
 * FSA_SUPPORTED=false にし、applyJson で注入したデータを描画させる。
 */
async function disableFSA(page) {
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
}

// 集計画面を開いて statsBody が描画されるまでの共通セットアップ
async function openStats(page, fixture) {
  await disableFSA(page);
  await page.goto("/index.html");
  await page.waitForLoadState("networkidle");
  await page.evaluate((fx) => {
    window.applyJson(fx);
  }, fixture);
  await page.locator("#toStats").click();
  await expect(page.locator("#screenStats")).not.toHaveClass(/hidden/);
}

// 行ヘルパー（必須フィールドのみ。集計に効くのは play / g / p / kk）
function row(play, g, p, kk = "") {
  return { n: "幹事", play, g, p, kk, wd: "", course: "", time: "", route: "" };
}

// ---- フィクスチャ A: 複数月・キャンセル混在（全2026年） ----
// 2026/01: コンペ2件 組数 3+4=7 人数 12+16=28、キャンセル1件
// 2026/02: コンペ1件 組数5 人数20、キャンセル0件
// 2026/03: キャンセル1件のみ（コンペ0件）
const FIX_A = {
  schemaVersion: 1,
  rows: [
    row("2026/01/10", 3, 12),
    row("2026/01/20", 4, 16),
    row("2026/01/25", 9, 99, "キャンセル"),
    row("2026/02/05", 5, 20),
    row("2026/03/15", 7, 28, "キャンセル"),
  ],
};

// ---- フィクスチャ B: 2025年と2026年の同月データ（前年対比） ----
// 2025/03: コンペ1件 人数10 / 2026/03: コンペ2件 人数 20+5=25
//   → 前年対比 件数 +1、人数 +15
const FIX_B = {
  schemaVersion: 1,
  rows: [row("2025/03/10", 2, 10), row("2026/03/10", 3, 20), row("2026/03/20", 1, 5)],
};

// ---- フィクスチャ C: play が空の行を含む ----
const FIX_C = {
  schemaVersion: 1,
  rows: [
    row("2026/05/10", 4, 16),
    row("", 4, 16),
    row("不明", 4, 16), // pd() でパースできない文字列
  ],
};

test("フィクスチャA: 月別の件数/組数/人数/キャンセル数が正しい", async ({ page }) => {
  await openStats(page, FIX_A);

  const tbl = page.locator(".stbl");
  await expect(tbl).toHaveCount(1); // 2026年セクションのみ

  const rows2026 = tbl.locator("tbody tr");
  // 1月・2月・3月 + 年間合計 = 4行
  await expect(rows2026).toHaveCount(4);

  // 1月: 月 / コンペ件数 / 組数 / 人数 / キャンセル件数
  const jan = rows2026.nth(0).locator("td");
  await expect(jan.nth(0)).toHaveText("1月");
  await expect(jan.nth(1)).toHaveText("2"); // コンペ件数
  await expect(jan.nth(2)).toHaveText("7"); // 組数
  await expect(jan.nth(3)).toHaveText("28"); // 人数
  await expect(jan.nth(4)).toHaveText("1"); // キャンセル件数

  // 2月
  const feb = rows2026.nth(1).locator("td");
  await expect(feb.nth(0)).toHaveText("2月");
  await expect(feb.nth(1)).toHaveText("1");
  await expect(feb.nth(2)).toHaveText("5");
  await expect(feb.nth(3)).toHaveText("20");
  await expect(feb.nth(4)).toHaveText("0");

  // 3月: キャンセルのみ
  const mar = rows2026.nth(2).locator("td");
  await expect(mar.nth(0)).toHaveText("3月");
  await expect(mar.nth(1)).toHaveText("0");
  await expect(mar.nth(2)).toHaveText("0");
  await expect(mar.nth(3)).toHaveText("0");
  await expect(mar.nth(4)).toHaveText("1");

  // 年間合計: コンペ3 / 組数12 / 人数48 / キャンセル2
  const total = rows2026.nth(3);
  await expect(total).toHaveClass(/total/);
  const tcells = total.locator("td");
  await expect(tcells.nth(0)).toHaveText("年間合計");
  await expect(tcells.nth(1)).toHaveText("3");
  await expect(tcells.nth(2)).toHaveText("12");
  await expect(tcells.nth(3)).toHaveText("48");
  await expect(tcells.nth(4)).toHaveText("2");

  // 前年データが無いので前年列は出ない（ヘッダは5列）
  await expect(tbl.locator("thead th")).toHaveCount(5);

  // プレー日不明の表示は無い
  await expect(page.locator(".stats-unknown")).toHaveCount(0);
});

test("フィクスチャB: 前年対比列が表示され増減値が正しい", async ({ page }) => {
  await openStats(page, FIX_B);

  // 2026年（上）と2025年（下）の2セクション
  const tables = page.locator(".stbl");
  await expect(tables).toHaveCount(2);

  // 新しい年が上 → 1つ目が2026年
  await expect(page.locator(".stats-year h3").nth(0)).toHaveText("2026年");
  await expect(page.locator(".stats-year h3").nth(1)).toHaveText("2025年");

  const t2026 = tables.nth(0);
  // 2026年は前年(2025/03)があるので前年列あり（ヘッダ7列）
  await expect(t2026.locator("thead th")).toHaveCount(7);
  await expect(t2026.locator("thead th").nth(5)).toHaveText("前年件数");
  await expect(t2026.locator("thead th").nth(6)).toHaveText("前年人数");

  // 2026/03 月行: コンペ2 人数25、前年件数1(+1) 前年人数10(+15)
  const mar = t2026.locator("tbody tr").nth(0).locator("td");
  await expect(mar.nth(0)).toHaveText("3月");
  await expect(mar.nth(1)).toHaveText("2"); // 件数
  await expect(mar.nth(3)).toHaveText("25"); // 人数
  await expect(mar.nth(5)).toContainText("1"); // 前年件数
  await expect(mar.nth(5)).toContainText("+1"); // 件数増減
  await expect(mar.nth(6)).toContainText("10"); // 前年人数
  await expect(mar.nth(6)).toContainText("+15"); // 人数増減

  // 2025年は前年(2024)が無いので前年列なし（ヘッダ5列）
  await expect(tables.nth(1).locator("thead th")).toHaveCount(5);
});

test("フィクスチャC: プレー日不明が表示される", async ({ page }) => {
  await openStats(page, FIX_C);

  // 空 + パース不能 = 2件
  const unknown = page.locator(".stats-unknown");
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toContainText("プレー日不明");
  await expect(unknown).toContainText("2件");

  // 有効な1件（2026/05）は集計に入る
  const may = page.locator(".stbl tbody tr").nth(0).locator("td");
  await expect(may.nth(0)).toHaveText("5月");
  await expect(may.nth(1)).toHaveText("1");
});

// 報告用スクリーンショット（assert なし）
test("集計画面のスクリーンショットを保存", async ({ page }) => {
  await openStats(page, FIX_B);
  await page.screenshot({ path: "test-results/stats-screen.png", fullPage: true });
});
