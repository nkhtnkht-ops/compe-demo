// ドメインロジック（判定・予定日計算・可視行・月別集計）。
// Phase 1 では純粋な移動と state. プレフィックス付与のみ。日付/重複ロジックの統合・修正は Phase 2。
import { state } from "./state.js";
import { pd, fmt, addDays } from "./dateutil.js";

export function recompute() {
  state.rows.forEach((r) => {
    const rc = pd(r.recv),
      pl = pd(r.play);
    r.d = [
      fmt(addDays(rc, state.o1)),
      fmt(addDays(pl, -state.o2)),
      fmt(addDays(pl, -state.o3)),
      fmt(addDays(pl, -state.o4)),
    ];
  });
}

export function actRound(r) {
  if (
    (r.kumi || "") === "済" ||
    r.kk === "キャンセル" ||
    (state.excludeKakutei && r.kk === "〇")
  )
    return -1;
  for (const i of [0, 1, 2, 3]) {
    if (!state.todayTouch[i]) continue;
    const dt = pd(r.d[i]);
    if (dt && dt <= state.TODAY && (r.s[i] === "" || r.s[i] === "不在")) return i;
  }
  return -1;
}

export function nextFuture(r) {
  if (
    (r.kumi || "") === "済" ||
    r.kk === "キャンセル" ||
    (state.excludeKakutei && r.kk === "〇")
  )
    return -1;
  for (const i of [0, 1, 2, 3]) {
    if (!state.todayTouch[i]) continue;
    const dt = pd(r.d[i]);
    if (dt && dt > state.TODAY && r.s[i] === "") return i;
  }
  return -1;
}

export function isDeferred(r) {
  return !!r.next && pd(r.next) > state.TODAY && (r.s || []).includes("不在");
}

export function isToday(r) {
  return actRound(r) >= 0 && !isDeferred(r);
}

export function inTodayView(r) {
  return isToday(r) || r._touch;
}

export function daysFrom(s) {
  const d = pd(s);
  return d ? Math.round((d - state.TODAY) / 86400000) : 0;
} // 正=未来, 負=過去

export function mdOf(s) {
  return (s || "").replace(/^\d{4}\//, "");
}

export function needsContact(r, i) {
  if (
    (r.kumi || "") === "済" ||
    r.kk === "キャンセル" ||
    (state.excludeKakutei && r.kk === "〇") ||
    isDeferred(r)
  )
    return false;
  const dt = pd(r.d[i]);
  return !!dt && dt <= state.TODAY && (r.s[i] === "" || r.s[i] === "不在");
}

export function visibleRows() {
  const q = state.searchQ.trim();
  const lq = q ? q.toLowerCase() : null;
  if (lq) {
    return state.rows.filter((r) => (r.n || "").toLowerCase().includes(lq));
  }
  if (state.contactFilter !== "") {
    const idx = +state.contactFilter;
    return state.rows.filter((r) => needsContact(r, idx));
  }
  return state.showAll ? state.rows : state.rows.filter(inTodayView);
}

// ===== 月別集計（純粋関数：DOM非依存・state非依存。rows を引数で受ける） =====
// 入力: rows（台帳行の配列。r.play=プレー日, r.g=組数, r.p=人数, r.kk=確定/キャンセル）
// 出力: { years:[{ year, months:[{month,compe,groups,people,cancel}], total:{...},
//           prevByMonth:{月->前年{compe,people}}, hasPrev:bool }...(降順)],
//         unknown:number(プレー日不明件数) }
export function aggregateMonthly(rows) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const byYear = {}; // year -> month(1..12) -> {compe,groups,people,cancel}
  let unknown = 0;
  (rows || []).forEach((r) => {
    const dt = pd(r && r.play); // 既存 pd() を再利用（新しい日付処理は書かない）
    if (!dt) {
      unknown++;
      return;
    }
    const y = dt.getFullYear(),
      m = dt.getMonth() + 1;
    byYear[y] = byYear[y] || {};
    const cell = (byYear[y][m] = byYear[y][m] || {
      compe: 0,
      groups: 0,
      people: 0,
      cancel: 0,
    });
    if (r.kk === "キャンセル") {
      cell.cancel++;
    } else {
      cell.compe++;
      cell.groups += num(r.g);
      cell.people += num(r.p);
    }
  });
  const years = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => b - a)
    .map((year) => {
      const mo = byYear[year];
      const months = Object.keys(mo)
        .map(Number)
        .sort((a, b) => a - b)
        .map((month) => ({
          month,
          compe: mo[month].compe,
          groups: mo[month].groups,
          people: mo[month].people,
          cancel: mo[month].cancel,
        }));
      const total = months.reduce(
        (t, m) => ({
          compe: t.compe + m.compe,
          groups: t.groups + m.groups,
          people: t.people + m.people,
          cancel: t.cancel + m.cancel,
        }),
        { compe: 0, groups: 0, people: 0, cancel: 0 }
      );
      // 前年同月の実データ（キャンセル除外集計）
      const prevMo = byYear[year - 1] || {};
      const prevByMonth = {};
      let hasPrev = false;
      Object.keys(prevMo)
        .map(Number)
        .forEach((month) => {
          const c = prevMo[month];
          if (c.compe > 0 || c.people > 0) {
            prevByMonth[month] = { compe: c.compe, people: c.people };
            hasPrev = true;
          }
        });
      return { year, months, total, prevByMonth, hasPrev };
    });
  return { years, unknown };
}
