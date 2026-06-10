// exporters.js の特性化テスト（SMS配信リストの集約・判定ロジック）。
// DOM 依存の smsFilteredRows / smsExport は E2E 側で担保。ここでは純粋な集約・判定を固定する。
import { describe, it, expect } from "vitest";
import {
  smsNormPhone,
  smsIsMobile,
  smsSurname,
  smsIsForeignName,
  smsAggregate,
} from "../../js/exporters.js";

describe("smsNormPhone / smsIsMobile", () => {
  it("数字以外を除去する", () => {
    expect(smsNormPhone("090-1111-2222")).toBe("09011112222");
    expect(smsNormPhone(null)).toBe("");
  });
  it("070/080/090 の11桁のみ携帯と判定", () => {
    expect(smsIsMobile("090-1111-2222")).toBe(true);
    expect(smsIsMobile("08011112222")).toBe(true);
    expect(smsIsMobile("0721-00-0000")).toBe(false); // 固定電話
    expect(smsIsMobile("0901111222")).toBe(false); // 桁不足
  });
});

describe("smsSurname（姓の抽出）", () => {
  it("空白（半角/全角）の前を姓にする", () => {
    expect(smsSurname("山田 太郎")).toBe("山田");
    expect(smsSurname("佐藤　花子")).toBe("佐藤");
  });
  it("空白が無ければ全体を返す（会社名等）", () => {
    expect(smsSurname("株式会社ABC")).toBe("株式会社ABC");
  });
  it("先頭が空白なら分割せず trim 後の全体（現挙動: i>0 のみ分割）", () => {
    expect(smsSurname("  山田太郎")).toBe("山田太郎");
  });
});

describe("smsIsForeignName（外国名判定）", () => {
  it("ローマ字・英字（全半角）は true", () => {
    expect(smsIsForeignName("John Smith")).toBe(true);
    expect(smsIsForeignName("ＡＢＣ")).toBe(true);
  });
  it("ハングルは true", () => {
    expect(smsIsForeignName("김철수")).toBe(true);
  });
  it("代表的な簡体字は true", () => {
    expect(smsIsForeignName("张伟")).toBe(true);
  });
  it("日本語の漢字名は false（判別不可＝手動マーク運用）", () => {
    expect(smsIsForeignName("山田太郎")).toBe(false);
  });
});

describe("smsAggregate（携帯番号での集約）", () => {
  const list = [
    { mob: "090-1111-2222", n: "山田太郎", play: "2026/01/10", course: "A", route: "GORA" },
    { mob: "09011112222", n: "山田T", play: "2026/05/20", course: "B", route: "GDO" },
    { mob: "080-3333-4444", n: "佐藤花子", play: "2026/02/01", course: "C", route: "電話" },
  ];
  it("dedupe=false は1件1行で正規化携帯を付ける（cnt=1）", () => {
    const out = smsAggregate(list, false);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ mob: "09011112222", cnt: 1 });
  });
  it("dedupe=true は同一携帯を集約し cnt を加算する", () => {
    const out = smsAggregate(list, true);
    expect(out).toHaveLength(2);
    const yamada = out.find((e) => e.mob === "09011112222");
    expect(yamada.cnt).toBe(2);
  });
  it("集約時は最新のプレー日の情報を採用する", () => {
    const out = smsAggregate(list, true);
    const yamada = out.find((e) => e.mob === "09011112222");
    expect(yamada.play).toBe("2026/05/20"); // 新しい方
    expect(yamada.n).toBe("山田T");
    expect(yamada.course).toBe("B");
    expect(yamada.route).toBe("GDO");
  });
  it("空リストは空配列", () => {
    expect(smsAggregate([], true)).toEqual([]);
    expect(smsAggregate([], false)).toEqual([]);
  });
});
