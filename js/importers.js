// CSV取込・Excel移行のパース／正規化ロジック。
// Phase 1 ステップ3では DOM やレンダリングに依存しない純粋なパース部だけを移設する。
// （extract/register/readCsvFile/onXlsxPicked/migrate 等の DOM オーケストレーションは
//  render.js / storage.js の依存解決後にステップ5で importers へ集約する。）
// ロジックは1文字も変えない。
import { parseDate, fmtSlash } from "./dateutil.js";

export const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function cellClean(s) {
  return (s || "")
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .trim();
}

export function normRoute(s) {
  s = cellClean(s);
  if (!s) return "その他";
  if (/事務所受け|電話|TEL/i.test(s)) return "電話";
  if (/AGWeb|AG.?Web/i.test(s)) return "AGWeb";
  if (/GORA|ＧＯＲＡ/i.test(s)) return "GORA";
  if (/GDO/i.test(s)) return "GDO";
  if (/RECRUIT|じゃらん|リクルート/i.test(s)) return "RECRUIT";
  if (/VALUE/i.test(s)) return "VALUE";
  return s;
}

export function cleanName(s) {
  return cellClean(s).replace(/代表者名/g, "").trim();
}

// CSV行を rows[] スキーマのオブジェクトへ。列順: 0場名1種別2プレー日3コース4時間5氏名6カナ7組数8人数9連絡先10携帯11FAX12経路13受付日時...
export function parseRow(c) {
  const playDt = parseDate(c[2]);
  const recvDt = parseDate(c[13]);
  const g = parseInt((c[7] || "").replace(/[^0-9]/g, "")) || 0;
  const p = parseInt((c[8] || "").replace(/[^0-9]/g, "")) || 0;
  const name = cleanName(c[5]);
  const tm = cellClean(c[4]).match(/(\d{1,2}):(\d{2})/) || [];
  return {
    n: name,
    play: fmtSlash(playDt),
    wd: playDt ? WD[playDt.getDay()] : "",
    course: cellClean(c[3]),
    time: tm.length ? tm[1].padStart(2, "0") + ":" + tm[2] : "",
    g,
    p,
    route: normRoute(c[12]),
    recv: fmtSlash(recvDt),
    d: ["", "", "", ""],
    s: ["", "", "", ""],
    kk: "",
    tel: cellClean(c[9]),
    mob: cellClean(c[10]),
    _playDt: playDt,
  };
}

// ===== 既存Excel台帳の移行用セル正規化 =====
export function xstat(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "不在" || s === "不要" ? s : "";
}
export function xkk(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "キャンセル" ? s : "";
}
export function xkumi(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "済" ? "済" : "";
}
export function xclean(v) {
  return (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
}
export function xnum(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^0-9]/g, ""));
  return isNaN(n) ? 0 : n;
}
