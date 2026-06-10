// エントリポイント。各モジュールを束ね、onclick属性ハンドラ用に必要関数を window へ公開し、
// 初期化を実行する。ここに残すのは「一覧操作（setS/setF 等の state ミューテーション）と
// 画面遷移・設定保存」のみ。取込/移行/書き出しは importers.js / exporters.js、
// 永続化は storage.js、描画は render.js に集約済み。ロジックは Phase 1 を通じて不変。
import { state } from "./state.js";
import { recompute } from "./domain.js";
import {
  WD,
  setImpMode,
  onXlsxPicked,
  migrate,
  dzOver,
  dzLeave,
  dzDrop,
  onCsvFile,
  extract,
  register,
} from "./importers.js";
import { exportExcel, smsPreview, smsExport } from "./exporters.js";
import {
  render,
  renderDetail,
  renderStrip,
  renderStats,
  editCell,
  routeSelect,
  toast,
  copyText,
  rebuildLabels,
} from "./render.js";
import {
  markDirty,
  applyJson,
  reloadFromFile,
  onOpenFile,
  onNewFile,
  onReauth,
  onSetBackupDir,
  manualBackup,
  updateBackupStatus,
  saveUpdatedBy,
} from "./storage.js";

// ===== 一覧操作（state ミューテーション → markDirty/render）。Phase 4 で addEventListener 化予定 =====
function setMemo(gi, val) {
  if (state.rows[gi]) {
    state.rows[gi].memo = val;
    markDirty();
  }
}
function setNum(gi, key, val) {
  if (!state.rows[gi]) return;
  const n = parseInt(String(val).replace(/[^0-9]/g, "")) || 0;
  if ((state.rows[gi][key] || 0) === n) return;
  state.rows[gi][key] = n;
  markDirty();
  render();
}
function setText(gi, key, val) {
  if (!state.rows[gi]) return;
  const v = (val || "").trim();
  if ((state.rows[gi][key] || "") === v) return;
  state.rows[gi][key] = v;
  markDirty();
  render();
}
function setPlay(gi, val) {
  if (!state.rows[gi]) return;
  const m = (val || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return;
  const y = +m[1],
    mo = +m[2],
    dd = +m[3];
  state.rows[gi].play = y + "/" + String(mo).padStart(2, "0") + "/" + String(dd).padStart(2, "0");
  state.rows[gi].wd = WD[new Date(y, mo - 1, dd).getDay()];
  recompute();
  markDirty();
  render();
} // プレー日変更→③④予定日も再計算

function onSearch(v) {
  state.searchQ = v;
  render();
}
function setContact(f) {
  state.contactFilter = f;
  [
    ["", "cfAll"],
    ["0", "cf0"],
    ["1", "cf1"],
    ["2", "cf2"],
    ["3", "cf3"],
  ].forEach(([v, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("on", state.contactFilter === v);
  });
  render();
}
function setS(gi, i, val, quiet) {
  const r = state.rows[gi];
  if (r.s[i] === val) return;
  state.undoStack.push({ gi, t: "s", i, prev: r.s[i] });
  r.s[i] = val;
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  if (!quiet) {
    if (val === "") toast(state.lbl[i] + "を空に戻しました");
    else if (val === "不在") toast(state.lbl[i] + "＝不在（繰越で残ります）");
    else toast(state.lbl[i] + "＝" + val + "（更新するまで一覧に残ります）");
  }
  markDirty();
  render();
}
function setF(gi, key, val, jp) {
  const r = state.rows[gi];
  if ((r[key] || "") === val) return;
  state.undoStack.push({ gi, t: "f", key, prev: r[key] || "" });
  r[key] = val;
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  toast(jp + "＝" + (val === "" ? "未" : val) + "（更新するまで一覧に残ります）");
  markDirty();
  render();
}
function skipToEarly(gi) {
  const r = state.rows[gi];
  const prev = [r.s[0], r.s[1], r.s[2]];
  if (prev.every((v) => v === "不要")) {
    toast("①〜③は既にスキップ済みです");
    return;
  }
  state.undoStack.push({ gi, t: "s3", prev });
  r.s[0] = "不要";
  r.s[1] = "不要";
  r.s[2] = "不要";
  r._touch = true;
  state.selIdx = gi;
  document.getElementById("undoBtn").disabled = false;
  toast("①〜③をスキップ（不要）。④だけ残します");
  markDirty();
  render();
}
function setNext(gi, v) {
  state.rows[gi].next = v ? v.replace(/-/g, "/") : "";
  state.rows[gi]._touch = true;
  markDirty();
  toast(
    v
      ? "次回連絡日 " + state.rows[gi].next + "（その日まで今日やることから外します）"
      : "次回連絡日をクリア"
  );
  render();
}
function undoLast() {
  if (state.undoStack.length === 0) {
    toast("戻す操作がありません");
    return;
  }
  const u = state.undoStack.pop();
  if (u.t === "f") {
    state.rows[u.gi][u.key] = u.prev;
  } else if (u.t === "s3") {
    [0, 1, 2].forEach((i, k) => (state.rows[u.gi].s[i] = u.prev[k]));
  } else {
    state.rows[u.gi].s[u.i] = u.prev;
  }
  state.rows[u.gi]._touch = true;
  state.selIdx = u.gi;
  document.getElementById("undoBtn").disabled = state.undoStack.length === 0;
  toast("元に戻しました：" + state.rows[u.gi].n);
  markDirty();
  render();
}
function refreshList() {
  state.rows.forEach((r) => (r._touch = false));
  state.undoStack = [];
  document.getElementById("undoBtn").disabled = true;
  toast("一覧を整理しました（解決済みを除外）");
  render();
}
function toggleMode() {
  state.showAll = !state.showAll;
  render();
}
function setMode(all) {
  state.showAll = all;
  render();
}
function setSort(k) {
  state.sortKey = k;
  document.getElementById("sortPlay").classList.toggle("on", k === "play");
  document.getElementById("sortRecv").classList.toggle("on", k === "recv");
  render();
}
function delRow(gi) {
  const r = state.rows[gi];
  if (!r) return;
  if (confirm(r.n + " を削除しますか？\n（この操作は元に戻せません）")) {
    state.rows.splice(gi, 1);
    if (state.selIdx >= state.rows.length) state.selIdx = Math.max(0, state.rows.length - 1);
    toast("削除しました：" + r.n);
    markDirty();
    render();
  }
}

// ===== 画面遷移 =====
function showScreen(name) {
  const main = name === "main";
  document.getElementById("screenMain").classList.toggle("hidden", name !== "main");
  document.getElementById("screenImport").classList.toggle("hidden", name !== "import");
  document.getElementById("screenSettings").classList.toggle("hidden", name !== "settings");
  document.getElementById("screenSms").classList.toggle("hidden", name !== "sms");
  document.getElementById("screenStats").classList.toggle("hidden", name !== "stats");
  ["modeSeg", "undoBtn", "toImport", "toSettings", "toSms", "toStats"].forEach((id) =>
    document.getElementById(id).classList.toggle("hidden", !main)
  );
  document.getElementById("refBtn").classList.toggle("hidden", !main || state.showAll);
  document.getElementById("toMain").classList.toggle("hidden", main);
  if (name === "settings") {
    const sb = document.getElementById("setUpdatedBy");
    if (sb) sb.value = state.updatedBy || "";
    updateBackupStatus();
  }
  if (name === "stats") {
    renderStats();
  }
}

// ===== 設定保存 =====
function saveSettings() {
  state.o1 = +document.getElementById("so1").value || 0;
  state.o2 = +document.getElementById("so2").value || 0;
  state.o3 = +document.getElementById("so3").value || 0;
  state.o4 = +document.getElementById("so4").value || 0;
  state.excludeKakutei = document.getElementById("setExKakutei").checked;
  state.todayTouch = [0, 1, 2, 3].map((i) => document.getElementById("tt" + i).checked);
  rebuildLabels();
  recompute();
  document.getElementById("setMsg").innerHTML =
    '<span style="color:#1a7f37;font-weight:700">保存しました（①〜④の予定日とラベルを再計算）。一覧へ戻ると反映されています</span>';
  toast("設定を保存しました");
  markDirty();
  render();
}

// ===== onclick属性ハンドラ用に window へ公開（Phase 4 で addEventListener 化予定） =====
// テスト用フック __state も併せて公開する。
Object.assign(window, {
  // 状態フック
  __state: state,
  // FSA / 保存（storage.js）
  reloadFromFile,
  onOpenFile,
  onNewFile,
  onReauth,
  onSetBackupDir,
  manualBackup,
  saveUpdatedBy,
  // Excel / SMS 書き出し（exporters.js）
  exportExcel,
  smsPreview,
  smsExport,
  // 集計・ストリップ（render.js）
  renderStrip,
  renderStats,
  // 一覧操作（main.js）
  setMode,
  toggleMode,
  refreshList,
  undoLast,
  setSort,
  setContact,
  onSearch,
  setS,
  setF,
  skipToEarly,
  setNext,
  setMemo,
  setNum,
  setText,
  setPlay,
  delRow,
  copyText,
  routeSelect,
  editCell,
  // 画面遷移・描画
  showScreen,
  render,
  renderDetail,
  // 設定
  saveSettings,
  // 取込・移行（importers.js）
  dzOver,
  dzLeave,
  dzDrop,
  onCsvFile,
  extract,
  register,
  onXlsxPicked,
  migrate,
  // テスト互換: applyJson（storage.js）
  applyJson,
});

// テスト互換: 既存E2Eが `window.TODAY = ...` で基準日を差し替えるため、
// state.TODAY と同期するアクセサを定義する（state が単一の真実）。
Object.defineProperty(window, "TODAY", {
  get() {
    return state.TODAY;
  },
  set(v) {
    state.TODAY = v;
  },
  configurable: true,
});

// ===== 初期化 =====
rebuildLabels();
recompute();
setImpMode("new");
render();
