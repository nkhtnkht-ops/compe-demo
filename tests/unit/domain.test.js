// domain.js の特性化テスト（現挙動をそのまま固定する）。
// recompute / actRound / nextFuture / needsContact / visibleRows / aggregateMonthly を対象に、
// 既知のバグも含めて「現在の振る舞い」を正として固定する（修正は Phase 2 以降）。
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../../js/state.js";
import {
  recompute,
  actRound,
  nextFuture,
  needsContact,
  visibleRows,
  aggregateMonthly,
  isDeferred,
} from "../../js/domain.js";

// 各テスト前に state を既定値へリセットし、基準日を固定する。
beforeEach(() => {
  state.TODAY = new Date(2026, 5, 3); // 2026/06/03
  state.o1 = 1;
  state.o2 = 60;
  state.o3 = 35;
  state.o4 = 18;
  state.excludeKakutei = true;
  state.todayTouch = [true, true, true, true];
  state.rows = [];
  state.searchQ = "";
  state.contactFilter = "";
  state.showAll = false;
});

// 行ヘルパー。d/s は未指定なら空配列で初期化（recompute で d は再計算される）。
function mkRow(o = {}) {
  return {
    n: o.n ?? "幹事",
    recv: o.recv ?? "",
    play: o.play ?? "",
    g: o.g ?? 0,
    p: o.p ?? 0,
    s: o.s ?? ["", "", "", ""],
    d: o.d ?? ["", "", "", ""],
    kk: o.kk ?? "",
    kumi: o.kumi ?? "",
    next: o.next,
    _touch: o._touch,
  };
}

describe("recompute（①〜④予定日の再計算）", () => {
  it("受付日+o1 / プレー日-o2,o3,o4 を YYYY/MM/DD で算出する", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    expect(state.rows[0].d).toEqual([
      "2026/05/02", // 受付+1
      "2026/05/11", // プレー-60
      "2026/06/05", // プレー-35
      "2026/06/22", // プレー-18
    ]);
  });
  it("受付日が空なら①は空、プレー日が空なら②③④は空", () => {
    state.rows = [mkRow({ recv: "", play: "" })];
    recompute();
    expect(state.rows[0].d).toEqual(["", "", "", ""]);
  });
  it("設定日数の変更が予定日に反映される", () => {
    state.o1 = 3;
    state.o4 = 10;
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    expect(state.rows[0].d[0]).toBe("2026/05/04"); // 受付+3
    expect(state.rows[0].d[3]).toBe("2026/06/30"); // プレー-10
  });
});

describe("actRound（今日対応すべきコンタクト番号）", () => {
  it("予定日が本日以前で未対応なら、その番号を返す（最小の i）", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    // ①2026/05/02 ②2026/05/11 ③2026/06/05 ④2026/06/22。TODAY=06/03 → ①②が期限到来、③④は未来
    expect(actRound(state.rows[0])).toBe(0);
  });
  it("①が対応済（〇）なら次の期限到来分（②）を返す", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["〇", "", "", ""] })];
    recompute();
    expect(actRound(state.rows[0])).toBe(1);
  });
  it("不在は未対応扱いで対象に残る", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["不在", "", "", ""] })];
    recompute();
    expect(actRound(state.rows[0])).toBe(0);
  });
  it("組合せ入力済(kumi=済)は -1（追跡終了）", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", kumi: "済" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(-1);
  });
  it("キャンセルは -1", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", kk: "キャンセル" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(-1);
  });
  it("excludeKakutei=true かつ 組数確定〇 は -1", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", kk: "〇" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(-1);
  });
  it("excludeKakutei=false なら 組数確定〇 でも追跡を続ける", () => {
    state.excludeKakutei = false;
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", kk: "〇" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(0);
  });
  it("todayTouch[0]=false なら①を飛ばして②を対象にする", () => {
    state.todayTouch = [false, true, true, true];
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(1);
  });
  it("全コンタクトが未来なら -1", () => {
    // プレー日を遠い未来にして②③④を未来へ、受付日も未来寄りに
    state.rows = [mkRow({ recv: "2026/06/10", play: "2026/12/31" })];
    recompute();
    expect(actRound(state.rows[0])).toBe(-1);
  });
});

describe("nextFuture（次に来る未来のコンタクト）", () => {
  it("期限未到来で未対応(空)の最小 i を返す", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["〇", "〇", "", ""] })];
    recompute();
    // ③2026/06/05 ④2026/06/22 が未来。③が空 → 2
    expect(nextFuture(state.rows[0])).toBe(2);
  });
  it("不在(空でない)は未来分の対象にしない（s[i]==='' のみ）", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["〇", "〇", "不在", ""] })];
    recompute();
    expect(nextFuture(state.rows[0])).toBe(3);
  });
  it("キャンセルは -1", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", kk: "キャンセル" })];
    recompute();
    expect(nextFuture(state.rows[0])).toBe(-1);
  });
});

describe("isDeferred（不在の次回連絡日待ち）", () => {
  it("next が未来 かつ s に不在を含むなら true", () => {
    const r = mkRow({ s: ["不在", "", "", ""], next: "2026/06/20" });
    expect(isDeferred(r)).toBe(true);
  });
  it("next が過去なら false", () => {
    const r = mkRow({ s: ["不在", "", "", ""], next: "2026/05/01" });
    expect(isDeferred(r)).toBe(false);
  });
  it("不在が無ければ false", () => {
    const r = mkRow({ s: ["〇", "", "", ""], next: "2026/06/20" });
    expect(isDeferred(r)).toBe(false);
  });
});

describe("needsContact（指定コンタクトが本日要対応か）", () => {
  it("期限到来・未対応なら true", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    expect(needsContact(state.rows[0], 0)).toBe(true);
  });
  it("未来の予定なら false", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10" })];
    recompute();
    expect(needsContact(state.rows[0], 2)).toBe(false); // ③は未来
  });
  it("対応済(〇)なら false", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["〇", "", "", ""] })];
    recompute();
    expect(needsContact(state.rows[0], 0)).toBe(false);
  });
  it("不在は要対応 true（繰越）", () => {
    state.rows = [mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["不在", "", "", ""] })];
    recompute();
    expect(needsContact(state.rows[0], 0)).toBe(true);
  });
  it("isDeferred な行は全コンタクトで false", () => {
    state.rows = [
      mkRow({ recv: "2026/05/01", play: "2026/07/10", s: ["不在", "", "", ""], next: "2026/06/20" }),
    ];
    recompute();
    expect(needsContact(state.rows[0], 0)).toBe(false);
  });
});

describe("visibleRows（一覧の可視行フィルタ）", () => {
  it("検索クエリは氏名の部分一致（大文字小文字無視）", () => {
    state.rows = [mkRow({ n: "架空太郎" }), mkRow({ n: "山田花子" })];
    recompute();
    state.searchQ = "架空";
    expect(visibleRows().map((r) => r.n)).toEqual(["架空太郎"]);
  });
  it("contactFilter 指定時はそのコンタクトが要対応の行のみ", () => {
    const a = mkRow({ n: "要対応者", recv: "2026/05/01", play: "2026/07/10" });
    const b = mkRow({ n: "済者", recv: "2026/05/01", play: "2026/07/10", s: ["〇", "", "", ""] });
    state.rows = [a, b];
    recompute();
    state.contactFilter = "0";
    expect(visibleRows().map((r) => r.n)).toEqual(["要対応者"]);
  });
  it("showAll=true なら全行を返す", () => {
    state.rows = [mkRow({ n: "A" }), mkRow({ n: "B" })];
    recompute();
    state.showAll = true;
    expect(visibleRows()).toHaveLength(2);
  });
  it("showAll=false（今日やること）は要対応 or _touch の行のみ", () => {
    const a = mkRow({ n: "要対応", recv: "2026/05/01", play: "2026/07/10" });
    const b = mkRow({ n: "完了", recv: "2026/05/01", play: "2026/07/10", kumi: "済" });
    const c = mkRow({ n: "操作直後", recv: "2026/05/01", play: "2026/07/10", kumi: "済", _touch: true });
    state.rows = [a, b, c];
    recompute();
    state.showAll = false;
    expect(visibleRows().map((r) => r.n)).toEqual(["要対応", "操作直後"]);
  });
});

describe("aggregateMonthly（月別集計・純粋関数）", () => {
  it("キャンセルを除いて件数/組数/人数を集計し、キャンセルは別カウント", () => {
    const rows = [
      mkRow({ play: "2026/01/10", n: "x" }),
      mkRow({ play: "2026/01/20", n: "y" }),
      mkRow({ play: "2026/01/25", n: "z", kk: "キャンセル" }),
    ];
    rows[0].g = 3;
    rows[0].p = 12;
    rows[1].g = 4;
    rows[1].p = 16;
    const { years } = aggregateMonthly(rows);
    expect(years).toHaveLength(1);
    const jan = years[0].months[0];
    expect(jan).toMatchObject({ month: 1, compe: 2, groups: 7, people: 28, cancel: 1 });
  });
  it("プレー日不明（空・パース不能）は unknown に積む", () => {
    const rows = [
      mkRow({ play: "2026/05/10", g: 4, p: 16 }),
      mkRow({ play: "" }),
      mkRow({ play: "不明" }),
    ];
    const { years, unknown } = aggregateMonthly(rows);
    expect(unknown).toBe(2);
    expect(years[0].months[0].compe).toBe(1);
  });
  it("年は降順、月は昇順で並ぶ", () => {
    const rows = [
      mkRow({ play: "2025/12/01", g: 1, p: 1 }),
      mkRow({ play: "2026/03/01", g: 1, p: 1 }),
      mkRow({ play: "2026/01/01", g: 1, p: 1 }),
    ];
    const { years } = aggregateMonthly(rows);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(years[0].months.map((m) => m.month)).toEqual([1, 3]);
  });
  it("前年同月の実データがあれば prevByMonth/hasPrev を持つ", () => {
    const rows = [
      mkRow({ play: "2025/03/10", g: 2, p: 10 }),
      mkRow({ play: "2026/03/10", g: 3, p: 20 }),
    ];
    const { years } = aggregateMonthly(rows);
    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026.hasPrev).toBe(true);
    expect(y2026.prevByMonth[3]).toEqual({ compe: 1, people: 10 });
  });
  it("g/p が文字列でも Number 化して集計（NaN は 0）", () => {
    const rows = [mkRow({ play: "2026/02/01", g: "5", p: "abc" })];
    const { years } = aggregateMonthly(rows);
    expect(years[0].months[0]).toMatchObject({ groups: 5, people: 0 });
  });
  it("空配列なら years 空・unknown 0", () => {
    expect(aggregateMonthly([])).toEqual({ years: [], unknown: 0 });
  });
});
