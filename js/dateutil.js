// 日付系ユーティリティ（Phase 2 で統合済み）。
// pd      : 文字列 → Date（YYYY/MM/DD または YYYY-MM-DD。1桁月日も可。不正は null）
// fmt     : Date → "YYYY/MM/DD"（Phase 1 では fmtSlash という別名が存在したが統合）
// addDays : Date + N日 → Date（元を破壊しない）
// todayStr: 今日の "YYYY-MM-DD"（storage のバックアップファイル名用）
// todayYmd: 今日の "YYYYMMDD"（ファイルダウンロード名用。exporters の ymd インライン置換）
// xdate   : Excel セル値（Date | 文字列 | null）→ "YYYY/MM/DD" または ""（移行用）
// xtime   : Excel セル値 → "HH:MM" または trim 文字列（移行用）

export function pd(s) {
  const m = s && s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function fmt(d) {
  return d
    ? d.getFullYear() +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(d.getDate()).padStart(2, "0")
    : "";
}

export function addDays(d, n) {
  if (!d) return null;
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function todayStr() {
  const n = new Date();
  return (
    n.getFullYear() +
    "-" +
    String(n.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(n.getDate()).padStart(2, "0")
  );
}

/** ファイル名用 YYYYMMDD（現在日時）。exporters の ymd インライン生成を置換。 */
export function todayYmd() {
  const n = new Date();
  return (
    n.getFullYear() +
    String(n.getMonth() + 1).padStart(2, "0") +
    String(n.getDate()).padStart(2, "0")
  );
}

export function xdate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v))
    return (
      v.getFullYear() +
      "/" +
      String(v.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(v.getDate()).padStart(2, "0")
    );
  const m = String(v).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? m[1] + "/" + m[2].padStart(2, "0") + "/" + m[3].padStart(2, "0") : "";
}

export function xtime(v) {
  if (v == null) return "";
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, "0") + ":" + m[2] : String(v).trim();
}
