// importers.js の特性化テスト（CSVパース・Excel移行セル正規化）。
// 現挙動をそのまま固定する（列ズレや split(',') の素朴さなど既知の弱点も現状を正とする。修正はPhase3）。
import { describe, it, expect } from "vitest";
import {
  cellClean,
  normRoute,
  cleanName,
  parseRow,
  xstat,
  xkk,
  xkumi,
  xclean,
  xnum,
  WD,
} from "../../js/importers.js";

describe("cellClean（前後の引用符と空白を除去）", () => {
  it("文字列境界の引用符を除去する", () => {
    expect(cellClean('"山田太郎"')).toBe("山田太郎");
  });
  it("シングルクォートも除去", () => {
    expect(cellClean("'GORA'")).toBe("GORA");
  });
  it("null/undefined は空文字", () => {
    expect(cellClean(null)).toBe("");
    expect(cellClean(undefined)).toBe("");
  });
  it("内部の引用符は残す（端のみ除去）", () => {
    expect(cellClean('a"b')).toBe('a"b');
  });
  // 【既知バグを現挙動として固定】引用符の除去は文字列の絶対端のみに作用する。
  // 前後に空白がある場合、引用符は端ではないため除去されず、trim 後に引用符が残る。
  it("前後に空白があると引用符が残る（既知バグ・現挙動を固定）", () => {
    expect(cellClean('  "山田太郎"  ')).toBe('"山田太郎"');
  });
});

describe("normRoute（経路の正規化）", () => {
  it("空は『その他』", () => {
    expect(normRoute("")).toBe("その他");
  });
  it("事務所受け/電話/TEL は『電話』", () => {
    expect(normRoute("事務所受け")).toBe("電話");
    expect(normRoute("TEL予約")).toBe("電話");
  });
  it("AGWeb・GORA・GDO・RECRUIT・VALUE を判定", () => {
    expect(normRoute("AGWeb")).toBe("AGWeb");
    expect(normRoute("ＧＯＲＡ")).toBe("GORA");
    expect(normRoute("GDO経由")).toBe("GDO");
    expect(normRoute("じゃらん")).toBe("RECRUIT");
    expect(normRoute("VALUEゴルフ")).toBe("VALUE");
  });
  it("未知の経路はクリーンした文字列をそのまま返す", () => {
    expect(normRoute("'特別ルート'")).toBe("特別ルート");
  });
});

describe("cleanName（代表者名ラベルの除去）", () => {
  it("『代表者名』の語を削除する", () => {
    expect(cleanName("代表者名山田太郎")).toBe("山田太郎");
  });
  it("境界の引用符を落とす（空白なし）", () => {
    expect(cleanName('"佐藤"')).toBe("佐藤");
  });
  // 【既知バグ】cellClean 経由のため、前後空白があると引用符が残る（現挙動を固定）
  it("前後に空白があると引用符が残る（既知バグ・現挙動を固定）", () => {
    expect(cleanName('  "佐藤"  ')).toBe('"佐藤"');
  });
});

describe("parseRow（CSV1行 → 台帳行スキーマ）", () => {
  // 列順: 0場名1種別2プレー日3コース4時間5氏名6カナ7組数8人数9連絡先10携帯11FAX12経路13受付日時
  const sample = [
    "泉佐野GC", "通常", "2026/07/10", "OUTコース", "8:30", "山田太郎", "ヤマダ",
    "3組", "12名", "0721-00-0000", "090-1111-2222", "FAX", "GORA", "2026/05/01 09:00",
  ];
  it("主要フィールドを正しく抽出する", () => {
    const r = parseRow(sample);
    expect(r.n).toBe("山田太郎");
    expect(r.play).toBe("2026/07/10");
    expect(r.recv).toBe("2026/05/01");
    expect(r.course).toBe("OUTコース");
    expect(r.time).toBe("08:30");
    expect(r.g).toBe(3);
    expect(r.p).toBe(12);
    expect(r.route).toBe("GORA");
    expect(r.tel).toBe("0721-00-0000");
    expect(r.mob).toBe("090-1111-2222");
  });
  it("曜日(wd)をプレー日から算出する（2026/07/10 は金）", () => {
    expect(parseRow(sample).wd).toBe(WD[new Date(2026, 6, 10).getDay()]);
    expect(parseRow(sample).wd).toBe("金");
  });
  it("組数/人数は数字以外を除いて整数化（無効は0）", () => {
    const r = parseRow([
      "", "", "2026/07/10", "", "", "氏名", "", "あ", "", "", "", "", "", "",
    ]);
    expect(r.g).toBe(0);
    expect(r.p).toBe(0);
  });
  it("プレー日が無効なら play 空・wd 空、_playDt は null", () => {
    const r = parseRow(["", "", "未定", "", "", "氏名", "", "3", "12", "", "", "", "", ""]);
    expect(r.play).toBe("");
    expect(r.wd).toBe("");
    expect(r._playDt).toBeNull();
  });
  it("時刻が無ければ time は空", () => {
    const r = parseRow([
      "", "", "2026/07/10", "C", "", "氏名", "", "3", "12", "", "", "", "GORA", "",
    ]);
    expect(r.time).toBe("");
  });
  it("d/s は空4要素、kk は空で初期化", () => {
    const r = parseRow(sample);
    expect(r.d).toEqual(["", "", "", ""]);
    expect(r.s).toEqual(["", "", "", ""]);
    expect(r.kk).toBe("");
  });
});

describe("Excel移行のセル正規化", () => {
  it("xstat は 〇/不在/不要 のみ通し、他は空", () => {
    expect(xstat("〇")).toBe("〇");
    expect(xstat("'不在'")).toBe("不在");
    expect(xstat("不要")).toBe("不要");
    expect(xstat("済")).toBe("");
    expect(xstat(null)).toBe("");
  });
  it("xkk は 〇/キャンセル のみ通す", () => {
    expect(xkk("〇")).toBe("〇");
    expect(xkk("キャンセル")).toBe("キャンセル");
    expect(xkk("不在")).toBe("");
  });
  it("xkumi は 済 のみ通す", () => {
    expect(xkumi("済")).toBe("済");
    expect(xkumi("〇")).toBe("");
  });
  it("xclean は引用符除去＋trim、null は空", () => {
    expect(xclean('  "あ"  ')).toBe("あ");
    expect(xclean(null)).toBe("");
  });
  it("xnum は数字以外を除去、無効は0", () => {
    expect(xnum("3組")).toBe(3);
    expect(xnum("")).toBe(0);
    expect(xnum(null)).toBe(0);
    expect(xnum("ab")).toBe(0);
  });
});
