// DOM 描画モジュール。render / renderDetail / renderStrip / renderStats /
// editCell / routeSelect / statDelta / toast / esc / copyText / fallbackCopy。
// 依存方向の整理（設計ルール4）に従い、render.js は state / domain / dateutil のみ import し、
// storage / importers / exporters は import しない（それらが render.js を import する一方向）。
// onclick 属性ハンドラ（setS/setF/onReauth/showScreen 等）は文字列のままなので import 不要。
// ロジックは1文字も変更しない。
import { state, FSA_SUPPORTED } from "./state.js";
import { pd } from "./dateutil.js";
import { actRound, nextFuture, daysFrom, mdOf, visibleRows, aggregateMonthly } from "./domain.js";
import { ST, KK, KUMI, TOAST_DURATION_MS } from "./constants.js";

// コンタクトの日数ラベル。設定変更時に表示も自動で変わる
const CIRC = ["①", "②", "③", "④"];
function dayLabel(i) {
  return i === 0
    ? state.o1 === 1
      ? "受付翌日"
      : "受付" + state.o1 + "日後"
    : [0, state.o2, state.o3, state.o4][i] + "日前";
}
export function rebuildLabels() {
  for (let i = 0; i < 4; i++) state.lbl[i] = CIRC[i] + dayLabel(i);
  ["cf0", "cf1", "cf2", "cf3"].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = dayLabel(i);
      el.title = state.lbl[i] + "の対応だけ表示";
    }
  });
  [0, 1, 2, 3].forEach((i) => {
    const el = document.getElementById("ttl" + i);
    if (el) el.textContent = state.lbl[i];
  }); // 設定のチェックボックス表示も連動
}

export function routeSelect(gi, cur) {
  const opts = ["AGWeb", "電話", "GORA", "GDO", "RECRUIT", "VALUE", "その他"];
  if (cur && opts.indexOf(cur) < 0) opts.unshift(cur);
  return (
    '<select onchange="setText(' +
    gi +
    ',\'route\',this.value)" class="numin" style="width:auto;text-align:left">' +
    opts
      .map((o) => "<option" + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>")
      .join("") +
    "</select>"
  );
}

export function renderStats() {
  const host = document.getElementById("statsBody");
  if (!host) return;
  const { years, unknown } = aggregateMonthly(state.rows);
  let html = "";
  if (!years.length) {
    html =
      '<div class="empty" style="text-align:left;padding:20px 0">集計できるプレー日のデータがありません。</div>';
  }
  years.forEach((y) => {
    const showPrev = y.hasPrev;
    html +=
      '<div class="stats-year"><h3>' +
      y.year +
      '年</h3><table class="stbl"><thead><tr>' +
      "<th>月</th><th>コンペ件数</th><th>組数</th><th>人数</th><th>キャンセル件数</th>" +
      (showPrev ? "<th>前年件数</th><th>前年人数</th>" : "") +
      "</tr></thead><tbody>";
    y.months.forEach((m) => {
      const prev = y.prevByMonth[m.month];
      html +=
        "<tr><td>" +
        m.month +
        "月</td><td>" +
        m.compe +
        "</td><td>" +
        m.groups +
        "</td><td>" +
        m.people +
        "</td><td>" +
        m.cancel +
        "</td>";
      if (showPrev) {
        if (prev) {
          html +=
            "<td>" +
            prev.compe +
            statDelta(m.compe - prev.compe) +
            "</td>" +
            "<td>" +
            prev.people +
            statDelta(m.people - prev.people) +
            "</td>";
        } else {
          html += "<td>—</td><td>—</td>";
        }
      }
      html += "</tr>";
    });
    html +=
      '<tr class="total"><td>年間合計</td><td>' +
      y.total.compe +
      "</td><td>" +
      y.total.groups +
      "</td><td>" +
      y.total.people +
      "</td><td>" +
      y.total.cancel +
      "</td>" +
      (showPrev ? "<td></td><td></td>" : "") +
      "</tr>";
    html += "</tbody></table></div>";
  });
  if (unknown > 0) {
    html += '<div class="stats-unknown">プレー日不明：' + unknown + "件</div>";
  }
  host.innerHTML = html;
}
// ===== 予約状況ストリップ（今月＋先3ヶ月・メイン画面専用・表示専用） =====
export function renderStrip() {
  const host = document.getElementById("monthStrip");
  if (!host) return;
  const { years } = aggregateMonthly(state.rows);
  // byYearMonth: year*100+month -> {compe, people} のマップ
  const byYM = {};
  years.forEach((y) =>
    y.months.forEach((m) => {
      byYM[y.year * 100 + m.month] = { compe: m.compe, people: m.people };
    })
  );
  const todayY = state.TODAY.getFullYear(),
    todayM = state.TODAY.getMonth() + 1; // 1..12
  const items = [];
  for (let i = 0; i <= 3; i++) {
    // i=0(今月)→3(3ヶ月先) 左から新しい順に積む
    let y = todayY,
      m = todayM + i;
    while (m > 12) {
      m -= 12;
      y++;
    }
    const cell = byYM[y * 100 + m] || { compe: 0, people: 0 };
    // 月ラベル: 年が今年(todayY)と異なる場合のみ年を前置
    const label = (y !== todayY ? (y % 100) + "/" : "") + m + "月";
    items.push({ y, m, label, compe: cell.compe, people: cell.people, current: i === 0 });
  }
  let html = '<span class="strip-label">予約状況</span>';
  items.forEach((c, idx) => {
    if (idx > 0) html += '<span class="strip-sep">｜</span>';
    const cls = "strip-item" + (c.current ? " current" : "");
    // 文言: 0件は件数のみ、1件以上は「n件・n人」
    const txt =
      c.compe === 0 ? c.label + " 0件" : c.label + " " + c.compe + "件・" + c.people + "人";
    html += '<span class="' + cls + '">' + txt + "</span>";
  });
  html +=
    '<span class="strip-sp"></span>' +
    '<button class="strip-link" onclick="showScreen(\'stats\')">詳細 →</button>';
  host.innerHTML = html;
}
// 増減バッジ（+n / −n。0 は表示しない）
export function statDelta(diff) {
  if (!diff) return "";
  const up = diff > 0;
  return (
    '<span class="delta ' +
    (up ? "up" : "down") +
    '">' +
    (up ? "+" + diff : "−" + Math.abs(diff)) +
    "</span>"
  );
}

export function render() {
  const vis = visibleRows();
  vis.sort((a, b) => {
    const ka = pd(state.sortKey === "recv" ? a.recv : a.play),
      kb = pd(state.sortKey === "recv" ? b.recv : b.play);
    return (ka ? ka.getTime() : 0) - (kb ? kb.getTime() : 0);
  });
  const cfLbl =
    state.contactFilter !== ""
      ? state.lbl[+state.contactFilter] + " 対応"
      : state.showAll
        ? "全件"
        : "今日やること";
  document.getElementById("countLbl").textContent =
    (state.searchQ.trim() ? "検索「" + state.searchQ.trim() + "」" : cfLbl) +
    "：" +
    vis.length +
    "件";
  document.getElementById("segToday").classList.toggle("on", !state.showAll);
  document.getElementById("segAll").classList.toggle("on", state.showAll);
  document.getElementById("refBtn").classList.toggle("hidden", state.showAll);
  document
    .getElementById("reauthBanner")
    .classList.toggle("hidden", !(FSA_SUPPORTED && state.needsReauth)); // 再接続が必要なら全幅バナーで強調
  const list = document.getElementById("list");
  list.innerHTML = "";
  // 未接続（FSA対応ブラウザでファイル未接続）なら、迷わないよう大きく案内
  // 権限再付与が必要（ハンドルは有るが権限切れ）＝中央に大きく「再接続」ボタンを出して見落とし防止
  if (FSA_SUPPORTED && state.fileHandle && state.needsReauth && !state.dataLoadedFromFile) {
    list.innerHTML =
      '<div class="empty connect-cta"><div class="cta-icon">🔓</div>' +
      '<div class="cta-title">前回の台帳に再接続します</div>' +
      '<div class="cta-sub">下のボタンを押すと、前回のファイル（<b>' +
      esc(state.fileName || "台帳") +
      "</b>）に接続して<br>最新データを読み込みます。</div>" +
      '<button class="btn b-blue cta-btn" onclick="onReauth()">再接続する（権限を許可）</button>' +
      '<div class="cta-note">クリック後、ブラウザの「許可」を押してください</div></div>';
    renderDetail();
    renderStrip();
    return;
  }
  if (FSA_SUPPORTED && !state.fileHandle) {
    const last = (() => {
      try {
        return localStorage.getItem("compe.lastFileName");
      } catch (_) {
        return null;
      }
    })();
    const lastLine = last
      ? '<div class="cta-file">前回のファイル：<b>' + esc(last) + "</b></div>"
      : "";
    list.innerHTML =
      '<div class="empty connect-cta"><div class="cta-icon">📂</div>' +
      '<div class="cta-title">台帳ファイル（JSON）を選んでください</div>' +
      '<div class="cta-sub">共有ドライブにある台帳ファイル（<b>○○○.json</b>）を選びます。<br>毎朝、最初に1回だけ選びます。</div>' +
      lastLine +
      '<button class="btn b-blue cta-btn" onclick="onOpenFile()">JSONファイルを選ぶ</button>' +
      '<div class="cta-note">初めて使う／新しく作る場合は「設定」の初回メニューから</div></div>';
    renderDetail();
    renderStrip();
    return;
  }
  if (vis.length === 0) {
    list.innerHTML =
      '<div class="empty">' +
      (state.searchQ.trim()
        ? "「" + state.searchQ.trim() + "」に一致する予約はありません"
        : state.contactFilter !== ""
          ? state.lbl[+state.contactFilter] + "の対応はありません"
          : state.showAll
            ? "データなし"
            : "今日やることはありません") +
      "</div>";
    renderDetail();
    renderStrip();
    return;
  }
  vis.forEach((r) => {
    const gi = state.rows.indexOf(r),
      a = actRound(r);
    let due, cls;
    if (a < 0) {
      if (r.kk === KK.CANCEL) {
        due = "✕ キャンセル";
        cls = "carry";
      } else if ((r.kumi || "") === KUMI.ZUMI) {
        due = "✓ 完了（組合せ入力済）";
        cls = "done";
      } else if (state.excludeKakutei && r.kk === KK.MARU) {
        due = "✓ 組数確定済";
        cls = "done";
      } else {
        const nf = nextFuture(r);
        if (nf >= 0) {
          due = "あと" + daysFrom(r.d[nf]) + "日：" + state.lbl[nf] + "（" + mdOf(r.d[nf]) + "）";
          cls = "soon";
        } else {
          due = "✓ 連絡完了・組合せ入力待ち";
          cls = "done";
        }
      }
    } else if (r.s[a] === ST.FUZAI) {
      if (r.next && pd(r.next) > state.TODAY) {
        due = "休止中：次回 " + mdOf(r.next) + "（あと" + daysFrom(r.next) + "日・不在）";
        cls = "soon";
      } else {
        const lt = -daysFrom(r.d[a]);
        due = "⟳ 繰越：" + state.lbl[a] + (lt > 0 ? "・" + lt + "日経過" : "");
        cls = "carry";
      }
    } else {
      const lt = -daysFrom(r.d[a]);
      if (lt > 0) {
        due = "要対応：" + state.lbl[a] + "（" + mdOf(r.d[a]) + "）・遅延" + lt + "日";
        cls = "late";
      } else {
        due = "要対応：" + state.lbl[a] + "（本日）";
        cls = "act";
      }
    }
    let ctrl;
    if (a < 0) {
      ctrl = `<span class="pill green">完了</span>`;
    } else {
      const cur = r.s[a];
      ctrl = `<div class="sel-wrap" onclick="event.stopPropagation()">
      <button class="sb done ${cur === "〇" ? "on-done" : ""}" onclick="setS(${gi},${a},'〇')">〇</button>
      <button class="sb zai ${cur === "不在" ? "on-zai" : ""}" onclick="setS(${gi},${a},'不在')">不在</button>
      <button class="sb fuyo ${cur === "不要" ? "on-fuyo" : ""}" onclick="setS(${gi},${a},'不要')">不要</button>
      ${cur ? `<button class="sb undo" onclick="setS(${gi},${a},'')">取消</button>` : ``}</div>`;
    }
    const div = document.createElement("div");
    div.className = "gi" + (gi === state.selIdx ? " sel" : "");
    const memoPrev = r.memo
      ? `<div class="memo-prev" title="${esc(r.memo)}">${esc(r.memo)}</div>`
      : ``;
    div.innerHTML = `<div class="main"><div class="nm">${r.n}</div><div class="meta1">${r.play.replace(/^\d{4}\//, "")}（${r.wd}）</div><div class="meta2">${r.course}${r.time ? ' ・ <span class="tm">' + r.time + "</span>" : ""} ・ ${r.g}組</div><div class="due ${cls}">${due}</div>${memoPrev}</div>${ctrl}`;
    div.onclick = () => {
      state.selIdx = gi;
      render();
    };
    list.appendChild(div);
  });
  renderDetail();
  renderStrip();
}
export function editCell(gi, i) {
  const r = state.rows[gi],
    v = r.s[i];
  const disp =
    v === ST.MARU
      ? '<span class="pill green">〇</span>'
      : v === ST.FUZAI
        ? '<span class="pill red">不在</span>'
        : v === ST.FUYO
          ? '<span style="color:#6b7280;font-weight:700">不要</span>'
          : '<span style="color:#374151">' + r.d[i] + "（予定）</span>";
  return `<div class="editcell"><span>${disp}</span><span class="sel-wrap">
    <button class="sb done ${v === "〇" ? "on-done" : ""}" onclick="setS(${gi},${i},'〇')">〇</button>
    <button class="sb zai ${v === "不在" ? "on-zai" : ""}" onclick="setS(${gi},${i},'不在')">不在</button>
    <button class="sb fuyo ${v === "不要" ? "on-fuyo" : ""}" onclick="setS(${gi},${i},'不要')">不要</button>
    <button class="sb undo" onclick="setS(${gi},${i},'')">空</button></span></div>`;
}
export function renderDetail() {
  const d = document.getElementById("detail");
  if (!state.rows[state.selIdx]) {
    d.innerHTML = '<div class="hint">左の一覧から予約を選んでください</div>';
    return;
  }
  const gi = state.selIdx,
    r = state.rows[gi],
    a = actRound(r);
  let head;
  if (a < 0) head = '<div class="v green">対応完了（要対応なし）</div>';
  else if (r.s[a] === ST.FUZAI)
    head = '<div class="v red">繰越（前回不在）：' + state.lbl[a] + "</div>";
  else
    head =
      '<div class="v" style="color:#b35900;font-weight:700">要対応：' +
      state.lbl[a] +
      "（" +
      r.d[a] +
      "）</div>";
  d.innerHTML = `
   <div class="dh"><span style="display:flex;align-items:center;gap:10px"><span class="name">${r.n}</span><button class="sb" onclick="copyText('${r.n}')">コピー</button></span><button class="delbtn" onclick="delRow(${gi})">削除</button></div>
   <div class="grid">
    <div class="fld"><div class="k">プレー日<span class="note">（変更で③④の予定日も再計算）</span></div><div class="editcell"><span class="numedit"><input type="date" value="${(r.play || "").replace(/\//g, "-")}" onchange="setPlay(${gi},this.value)" class="numin" style="width:150px;text-align:left"> （${r.wd || "-"}）</span></div></div>
    <div class="fld"><div class="k">組数 / 人数<span class="note">（変更があれば直せます）</span></div><div class="editcell"><span class="numedit"><input type="number" min="0" value="${r.g}" onchange="setNum(${gi},'g',this.value)" class="numin numin-sm">組 / <input type="number" min="0" value="${r.p}" onchange="setNum(${gi},'p',this.value)" class="numin numin-sm">人</span></div></div>
    <div class="fld"><div class="k">コース名</div><div class="editcell"><input type="text" value="${esc(r.course)}" onchange="setText(${gi},'course',this.value)" class="numin" style="flex:1;min-width:0;text-align:left"></div></div>
    <div class="fld"><div class="k">スタート時間</div><div class="editcell"><input type="time" value="${r.time || ""}" onchange="setText(${gi},'time',this.value)" class="numin" style="width:130px;text-align:left"></div></div>
    <div class="fld"><div class="k">連絡先電話番号</div><div class="editcell"><input type="text" value="${esc(r.tel)}" onchange="setText(${gi},'tel',this.value)" class="numin" style="flex:1;min-width:0;text-align:left"><button class="sb" onclick="copyText('${r.tel}')">コピー</button></div></div>
    <div class="fld"><div class="k">携帯電話番号</div><div class="editcell"><input type="text" value="${esc(r.mob)}" onchange="setText(${gi},'mob',this.value)" class="numin" style="flex:1;min-width:0;text-align:left"><button class="sb" onclick="copyText('${r.mob}')">コピー</button></div></div>
    <div class="fld"><div class="k">経路</div><div class="editcell">${routeSelect(gi, r.route)}</div></div>
    <div class="fld"><div class="k">いまの対応状況</div>${head}</div>
   </div>
   <div class="sec">確定・キャンセル・組合せ</div>
   <div class="onecard">
    <div class="orow">
     <div class="ok">組数確定／キャンセル <span class="note">（確定〇は情報のみ・追跡継続／キャンセルは終了）</span></div>
     <span class="sel-wrap">
      <button class="sb ${(r.kk || "") === "" ? "on-fuyo" : ""}" onclick="setF(${gi},'kk','','組数確定')">未</button>
      <button class="sb done ${r.kk === "〇" ? "on-done" : ""}" onclick="setF(${gi},'kk','〇','組数確定')">確定〇</button>
      <button class="sb zai ${r.kk === "キャンセル" ? "on-zai" : ""}" onclick="setF(${gi},'kk','キャンセル','キャンセル')">キャンセル</button>
     </span>
    </div>
    <div class="orow">
     <div class="ok">組合せ入力 <span class="note">（入力済で追跡終了）</span></div>
     <span class="sel-wrap">
      <button class="sb ${(r.kumi || "") === "" ? "on-fuyo" : ""}" onclick="setF(${gi},'kumi','','組合せ入力')">未</button>
      <button class="sb done ${(r.kumi || "") === "済" ? "on-done" : ""}" onclick="setF(${gi},'kumi','済','組合せ入力')">入力済</button>
     </span>
    </div>
    <div class="orow">
     <div class="ok">インバウンド <span class="note">（訪日客。SMS配信リストから除外できます）</span></div>
     <span class="sel-wrap">
      <button class="sb ${(r.inbound || "") === "" ? "on-fuyo" : ""}" onclick="setF(${gi},'inbound','','インバウンド')">通常</button>
      <button class="sb zai ${r.inbound === "〇" ? "on-zai" : ""}" onclick="setF(${gi},'inbound','〇','インバウンド')">インバウンド</button>
     </span>
    </div>
   </div>
   <div class="sec">フォロー状況（ここで直接変更・修正できます）</div>
   <div class="grid">
    <div class="fld"><div class="k">${state.lbl[0]}</div>${editCell(gi, 0)}</div>
    <div class="fld"><div class="k">${state.lbl[1]}</div>${editCell(gi, 1)}</div>
    <div class="fld"><div class="k">${state.lbl[2]}</div>${editCell(gi, 2)}</div>
    <div class="fld"><div class="k">${state.lbl[3]}</div>${editCell(gi, 3)}</div>
   </div>
   <div style="margin-top:10px"><button class="sb" onclick="skipToEarly(${gi})" title="メンバー・定例コンペ向け：①〜③を不要にして④だけ残します">${state.lbl[3]}までスキップ（メンバー/定例コンペ）</button></div>
   ${
     (r.s || []).includes(ST.FUZAI)
       ? `<div class="sec">次回連絡日（不在の再架電）</div>
   <div class="editcell"><span>${r.next ? "設定：" + r.next + "（その日まで今日やることから外します）" : "未設定（不在は毎日「今日やること」に表示）"}</span><span class="sel-wrap"><input type="date" class="datein" value="${r.next ? r.next.replace(/\//g, "-") : ""}" onchange="setNext(${gi},this.value)"><button class="sb" onclick="setNext(${gi},'')">クリア</button></span></div>`
       : ""
   }
   <div class="sec">メモ（連絡内容・申し送り）</div>
   <textarea oninput="setMemo(${gi},this.value)" placeholder="例）6/3 田中様へ連絡、組数は3組で確定見込み。次回6/15に再確認。" style="width:100%;height:84px;border:1px solid var(--line);border-radius:6px;padding:10px;font-size:13px;font-family:inherit">${(r.memo || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</textarea>
   <p style="color:#9aa1aa;font-size:12px;margin-top:14px">戻し方は2通り：①上部 <b>元に戻す</b> で直前操作を取消／②この詳細で各コンタクトを選び直し（<b>全件</b>表示にすれば完了済みの予約も探して修正できます）。「不在」は〇/不要にするまで繰越で残ります。</p>`;
}
export function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function toast(m) {
  const t = document.getElementById("toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), TOAST_DURATION_MS);
}
export function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(
      () => toast("コピーしました：" + t),
      () => fallbackCopy(t)
    );
  } else {
    fallbackCopy(t);
  }
}
export function fallbackCopy(t) {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    toast("コピーしました：" + t);
  } catch (e) {
    toast("コピーできませんでした");
  }
  document.body.removeChild(ta);
}
