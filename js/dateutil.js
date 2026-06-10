// 日付系ユーティリティ（Phase 1 では純粋な移動のみ。統合・改名・修正は Phase 2 の仕事）。
// 元 index.html の pd / fmt / fmtSlash / parseDate / todayStr / addDays / xdate / xtime を
// ロジック1文字変えずに移設した。重複実装（pd と parseDate, fmt と fmtSlash と xdate 等）も
// 現状のまま温存する。

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

export function parseDate(s) {
  const m = (s || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function fmtSlash(d) {
  return d
    ? d.getFullYear() +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(d.getDate()).padStart(2, "0")
    : "";
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
