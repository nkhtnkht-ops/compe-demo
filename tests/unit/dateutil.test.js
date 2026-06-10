// dateutil.js の特性化テスト（Phase 2 統合後）。
// pd = parseDate（統合済み）、fmt = fmtSlash（統合済み）、todayYmd 追加。
import { describe, it, expect } from "vitest";
import { pd, fmt, addDays, todayYmd, xdate, xtime } from "../../js/dateutil.js";

describe("pd（日付パース）", () => {
  it("YYYY/MM/DD をローカル Date に変換する", () => {
    const d = pd("2026/06/03");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0始まり
    expect(d.getDate()).toBe(3);
  });
  it("YYYY-MM-DD 区切りも受け付ける", () => {
    const d = pd("2026-12-31");
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
  it("1桁の月日も受け付ける", () => {
    const d = pd("2026/1/5");
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
  it("空文字は null", () => {
    expect(pd("")).toBeNull();
  });
  it("パース不能な文字列は null", () => {
    expect(pd("不明")).toBeNull();
  });
  it("文字列中に日付が含まれていれば先頭一致で拾う（現挙動）", () => {
    const d = pd("受付 2026/06/03 12:00");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getDate()).toBe(3);
  });
});

describe("fmt（Date → YYYY/MM/DD ゼロ埋め）", () => {
  it("ゼロ埋めしてスラッシュ区切りに整形する", () => {
    expect(fmt(new Date(2026, 0, 5))).toBe("2026/01/05");
  });
  it("null は空文字", () => {
    expect(fmt(null)).toBe("");
  });
  it("pd と組み合わせて往復できる", () => {
    expect(fmt(pd("2026/6/3"))).toBe("2026/06/03");
  });
});

describe("addDays（日付加算）", () => {
  it("正の日数を足す", () => {
    expect(fmt(addDays(new Date(2026, 5, 3), 1))).toBe("2026/06/04");
  });
  it("負の日数（プレー日からのN日前）を引く", () => {
    expect(fmt(addDays(new Date(2026, 5, 3), -18))).toBe("2026/05/16");
  });
  it("月をまたぐ加算", () => {
    expect(fmt(addDays(new Date(2026, 5, 30), 5))).toBe("2026/07/05");
  });
  it("null は null を返す", () => {
    expect(addDays(null, 5)).toBeNull();
  });
  it("元の Date を破壊しない（コピーして加算）", () => {
    const base = new Date(2026, 5, 3);
    addDays(base, 10);
    expect(base.getDate()).toBe(3);
  });
});

describe("todayYmd（ファイル名用 YYYYMMDD）", () => {
  it("今日の日付を 8桁数字文字列で返す", () => {
    const ymd = todayYmd();
    expect(ymd).toMatch(/^\d{8}$/);
    const n = new Date();
    const expected =
      n.getFullYear() +
      String(n.getMonth() + 1).padStart(2, "0") +
      String(n.getDate()).padStart(2, "0");
    expect(ymd).toBe(expected);
  });
  it("pd + fmt + todayYmd の出力形式が整合する（YYYY/MM/DD vs YYYYMMDD）", () => {
    // fmt は YYYY/MM/DD、todayYmd は YYYYMMDD。スラッシュを除いて対応関係を検証
    const d = new Date(2026, 0, 5);
    expect(fmt(d).replace(/\//g, "")).toBe("20260105");
    // todayYmd は現在時刻に依存するため桁数と数値性だけ確認（上のケースで値一致済み）
    expect(Number(todayYmd())).toBeGreaterThan(20000000);
  });
});

describe("xdate（Excel移行用の日付整形）", () => {
  it("Date インスタンスを YYYY/MM/DD に整形", () => {
    expect(xdate(new Date(2026, 5, 3))).toBe("2026/06/03");
  });
  it("文字列の日付を整形（ゼロ埋め）", () => {
    expect(xdate("2026-6-3")).toBe("2026/06/03");
  });
  it("null/空は空文字", () => {
    expect(xdate(null)).toBe("");
    expect(xdate("")).toBe("");
  });
  it("日付を含まない文字列は空文字", () => {
    expect(xdate("見出し")).toBe("");
  });
});

describe("xtime（Excel移行用の時刻整形）", () => {
  it("HH:MM を抽出しゼロ埋め", () => {
    expect(xtime("9:05")).toBe("09:05");
  });
  it("時刻が無ければ trim した文字列をそのまま返す（現挙動）", () => {
    expect(xtime(" 午前 ")).toBe("午前");
  });
  it("null は空文字", () => {
    expect(xtime(null)).toBe("");
  });
});
