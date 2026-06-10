// エントリポイント（Phase 1 ステップ1）。
// 元 index.html のインラインJSを ES Module へ移設。ロジックは不変。
// グローバル変数は state. プレフィックスへ機械的に置換し、onclick属性ハンドラ用に
// 必要関数を window へ公開する。後続ステップで各モジュールへ切り出す。
import { state } from "./state.js";

/* global XLSX, cptable */

const SCHEMA_VERSION = 1;
function useRealToday() {
  const n = new Date();
  state.TODAY = new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// ===== File System Access API + IndexedDB（ファイルハンドル永続化） =====
const FSA_SUPPORTED = !!(window.showOpenFilePicker && window.showSaveFilePicker);
const IDB_NAME = "compe-yoyaku",
  IDB_STORE = "kv",
  HANDLE_KEY = "fileHandle",
  BACKUP_DIR_KEY = "backupDir";

function fmtMeta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return (
    d.getMonth() +
    1 +
    "/" +
    d.getDate() +
    " " +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}
function updateUpdatedChip() {
  const el = document.getElementById("updatedInfo");
  if (!el) return;
  if (!state.fileHandle) {
    el.textContent = "ファイル未接続（メモリ動作）";
    return;
  }
  el.textContent = state.loadedUpdatedBy
    ? "最終更新： " + state.loadedUpdatedBy + "　" + fmtMeta(state.loadedUpdatedAt)
    : "最終更新： —";
}
function showExtWarn(b) {
  document.getElementById("extWarn")?.classList.toggle("hidden", !b);
}
async function reloadFromFile() {
  if (!state.fileHandle) {
    return;
  }
  if (
    state.isDirty &&
    !confirm(
      "未保存の変更があります。最新のファイルを読み直すと、あなたの未保存の変更は失われます。読み直しますか？"
    )
  )
    return;
  state.externalChange = false;
  showExtWarn(false);
  await loadFromHandle(state.fileHandle);
}
async function checkExternal() {
  if (!state.fileHandle || state.isSaving || state.externalChange) return;
  try {
    const f = await state.fileHandle.getFile();
    if (f.lastModified > state.lastWrittenMtime + 1500) {
      // 自分の最終書込より新しい＝他者が更新
      state.externalChange = true;
      showExtWarn(true);
      setFileStatus("⚠ 別の人が更新（読み直してください）", "warn");
    }
  } catch (e) {
    /* 権限切れ等は別経路で扱う */
  }
}

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbGet(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const r = tx.objectStore(IDB_STORE).put(v, k);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const r = tx.objectStore(IDB_STORE).delete(k);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

function setFileStatus(text, cls) {
  const el = document.getElementById("fileStatus");
  el.textContent = text;
  el.classList.remove("ok", "warn", "err");
  if (cls) el.classList.add(cls);
}
function showReauth(show) {
  document.getElementById("btnReauth").classList.toggle("hidden", !show);
}

async function ensurePermission(handle, mode) {
  if (!handle) return "denied";
  const opts = { mode: mode || "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return "granted";
  return await handle.requestPermission(opts);
}

function buildJson() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      updatedAt: new Date().toISOString(),
      updatedBy: state.updatedBy || "",
      tenpo: "泉佐野",
    },
    settings: {
      o1: state.o1,
      o2: state.o2,
      o3: state.o3,
      o4: state.o4,
      excludeKakutei: state.excludeKakutei,
      todayTouch: state.todayTouch,
    },
    rows: state.rows.map((r) => {
      // _touchは実行時フラグなので保存しない
      const { _touch, ...rest } = r;
      return rest;
    }),
  };
}

function applyJson(data) {
  if (!data || typeof data !== "object") throw new Error("JSONが不正です");
  if (data.schemaVersion && data.schemaVersion > SCHEMA_VERSION)
    throw new Error("未対応のschemaVersion: " + data.schemaVersion);
  const s = data.settings || {};
  if (typeof s.o1 === "number") state.o1 = s.o1;
  if (typeof s.o2 === "number") state.o2 = s.o2;
  if (typeof s.o3 === "number") state.o3 = s.o3;
  if (typeof s.o4 === "number") state.o4 = s.o4;
  if (typeof s.excludeKakutei === "boolean") state.excludeKakutei = s.excludeKakutei;
  if (document.getElementById("setExKakutei"))
    document.getElementById("setExKakutei").checked = state.excludeKakutei;
  if (Array.isArray(s.todayTouch) && s.todayTouch.length === 4)
    state.todayTouch = s.todayTouch.map(Boolean);
  [0, 1, 2, 3].forEach((i) => {
    const el = document.getElementById("tt" + i);
    if (el) el.checked = state.todayTouch[i];
  });
  if (s.courseName && document.getElementById("setCourse"))
    document.getElementById("setCourse").value = s.courseName;
  if (s.listName && document.getElementById("setList"))
    document.getElementById("setList").value = s.listName;
  if (document.getElementById("so1")) document.getElementById("so1").value = state.o1;
  if (document.getElementById("so2")) document.getElementById("so2").value = state.o2;
  if (document.getElementById("so3")) document.getElementById("so3").value = state.o3;
  if (document.getElementById("so4")) document.getElementById("so4").value = state.o4;
  state.rows = Array.isArray(data.rows)
    ? data.rows.map((r) => ({ s: ["", "", "", ""], d: ["", "", "", ""], ...r }))
    : [];
  state.rows.forEach((r) => {
    delete r._touch;
    if (!Array.isArray(r.s)) r.s = ["", "", "", ""];
    if (!Array.isArray(r.d)) r.d = ["", "", "", ""];
  });
  rebuildLabels();
  recompute();
}

async function loadFromHandle(handle) {
  state.suspendDirty = true;
  try {
    const file = await handle.getFile();
    const text = await file.text();
    const data = text.trim()
      ? JSON.parse(text)
      : { schemaVersion: SCHEMA_VERSION, rows: [] };
    applyJson(data);
    state.fileHandle = handle;
    state.fileName = handle.name || file.name || "data.json";
    try {
      localStorage.setItem("compe.lastFileName", state.fileName);
    } catch (_) {} // 再選択案内用に前回名を記憶
    state.dataLoadedFromFile = true;
    state.lastKnownCount = state.rows.length; // 読み込んだ件数を基準に
    state.needsReauth = false; // 接続成功＝再付与バナー解除
    state.isDirty = false;
    state.lastWrittenMtime = file.lastModified;
    state.externalChange = false;
    showExtWarn(false);
    state.loadedUpdatedAt = (data.meta && data.meta.updatedAt) || "";
    state.loadedUpdatedBy = (data.meta && data.meta.updatedBy) || "";
    updateUpdatedChip();
    useRealToday(); // 実データは当日基準で判定
    recompute();
    document.getElementById("demoNote")?.classList.add("hidden");
    setFileStatus("" + state.fileName + "（同期OK）", "ok");
    state.selIdx = Math.min(state.selIdx, Math.max(0, state.rows.length - 1));
    render();
    toast("ファイルを読み込みました：" + state.rows.length + "件");
    // ソフト「使用中」：直前(10分以内)に別の人が更新していたら注意
    if (
      state.loadedUpdatedBy &&
      state.updatedBy &&
      state.loadedUpdatedBy !== state.updatedBy &&
      state.loadedUpdatedAt
    ) {
      const mins = (Date.now() - new Date(state.loadedUpdatedAt).getTime()) / 60000;
      if (mins >= 0 && mins < 10) {
        setTimeout(
          () =>
            toast(
              "⚠ " +
                state.loadedUpdatedBy +
                " さんが直前（" +
                fmtMeta(state.loadedUpdatedAt) +
                "）まで操作していました。重複編集にご注意ください"
            ),
          300
        );
      }
    }
  } finally {
    state.suspendDirty = false;
  }
}

async function saveToFile() {
  if (!state.fileHandle) {
    return;
  }
  // ★未読込かつ空(0件)の状態でファイルを上書きしない（全消し事故防止）。データがある正当な保存は通す
  if (!state.dataLoadedFromFile && state.rows.length === 0) {
    setFileStatus("🔒 未接続", "warn");
    return;
  }
  if (state.isSaving) {
    markDirty();
    return;
  } // 競合時は次回キックで
  // ★件数が大きく減る保存は確認（誤操作・バグでの全消し最終防波堤）
  if (state.lastKnownCount >= 20 && state.rows.length < state.lastKnownCount / 2) {
    const ok = confirm(
      "⚠ 台帳の件数が大きく減ろうとしています（" +
        state.lastKnownCount +
        "件 → " +
        state.rows.length +
        "件）。\n\nこのまま保存すると元のデータが上書きされます。\n[OK]保存する / [キャンセル]保存しない（データを守る）"
    );
    if (!ok) {
      state.isDirty = false;
      setFileStatus("⚠ 保存を中止", "warn");
      return;
    }
  }
  state.isSaving = true;
  try {
    const perm = await ensurePermission(state.fileHandle, "readwrite");
    if (perm !== "granted") {
      setFileStatus("🔒 権限切れ", "err");
      showReauth(true);
      state.needsReauth = true;
      render();
      return;
    }
    // 他者更新の検知：自分の最終書込より新しければ上書き確認
    try {
      const cur = await state.fileHandle.getFile();
      if (cur.lastModified > state.lastWrittenMtime + 1500) {
        state.externalChange = true;
        showExtWarn(true);
        const ok = confirm(
          "別の人がこのファイルを更新しています。\n\n[OK]：あなたの変更で上書き保存する\n[キャンセル]：保存せず残す（上の「読み直す」で最新を取得できます）"
        );
        if (!ok) {
          state.isDirty = true;
          setFileStatus("⚠ 保存保留（別の人が更新）", "warn");
          return;
        }
        state.externalChange = false;
        showExtWarn(false);
      }
    } catch (_) {}
    const json = buildJson();
    state.loadedUpdatedAt = json.meta.updatedAt;
    state.loadedUpdatedBy = json.meta.updatedBy;
    const w = await state.fileHandle.createWritable();
    await w.write(
      new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
    );
    await w.close();
    state.isDirty = false;
    state.lastKnownCount = state.rows.length; // 保存できた件数を基準に更新
    try {
      state.lastWrittenMtime = (await state.fileHandle.getFile()).lastModified;
    } catch (_) {
      state.lastWrittenMtime = Date.now();
    }
    maybeBackup(); // 日付付き自動バックアップ（best-effort）
    updateUpdatedChip();
    setFileStatus(
      "" + state.fileName + "（保存済 " + new Date().toLocaleTimeString("ja-JP") + "）",
      "ok"
    );
  } catch (e) {
    console.error(e);
    setFileStatus("⚠ 保存エラー：" + (e.message || e), "err");
    toast("保存に失敗しました：" + (e.message || e));
  } finally {
    state.isSaving = false;
    if (state.isDirty) {
      scheduleSave();
    }
  }
}

function scheduleSave() {
  if (!state.fileHandle) return;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveToFile, 1500);
}
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
function routeSelect(gi, cur) {
  const opts = ["AGWeb", "電話", "GORA", "GDO", "RECRUIT", "VALUE", "その他"];
  if (cur && opts.indexOf(cur) < 0) opts.unshift(cur);
  return (
    '<select onchange="setText(' +
    gi +
    ",'route',this.value)\" class=\"numin\" style=\"width:auto;text-align:left\">" +
    opts
      .map((o) => "<option" + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>")
      .join("") +
    "</select>"
  );
}
function markDirty() {
  if (state.suspendDirty) return;
  state.isDirty = true;
  if (state.fileHandle) {
    setFileStatus("" + state.fileName + "（編集中…）", "warn");
    scheduleSave();
  }
}

// ===== 日付付き自動バックアップ（共有ドライブの台帳と同じフォルダ等に保存） =====
function backupBaseName() {
  return (state.fileName || "台帳").replace(/\.json$/i, "");
}
function todayStr() {
  const n = new Date();
  return (
    n.getFullYear() +
    "-" +
    String(n.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(n.getDate()).padStart(2, "0")
  );
}
async function writeBackup(force) {
  if (!state.backupDirHandle) return false;
  if (!state.dataLoadedFromFile || state.rows.length === 0) return false; // 空/未読込はバックアップしない
  try {
    let perm = await state.backupDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      if (force) {
        perm = await state.backupDirHandle.requestPermission({ mode: "readwrite" });
      }
      if (perm !== "granted") return false;
    }
    const name = backupBaseName() + "_backup_" + todayStr() + ".json";
    const fh = await state.backupDirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(
      new Blob([JSON.stringify(buildJson(), null, 2)], { type: "application/json" })
    );
    await w.close();
    state.lastBackupTime = Date.now();
    localStorage.setItem(
      "compe.lastBackup",
      todayStr() + " " + new Date().toLocaleTimeString("ja-JP")
    );
    rotateBackups().catch(() => {});
    updateBackupStatus();
    return true;
  } catch (e) {
    console.warn("backup failed", e);
    return false;
  }
}
async function maybeBackup() {
  if (!state.backupDirHandle) return;
  // 新しい日付なら必ず、同日内は5分に1回まで
  const lastDay = (localStorage.getItem("compe.lastBackup") || "").slice(0, 10);
  if (lastDay !== todayStr() || Date.now() - state.lastBackupTime > 5 * 60 * 1000) {
    await writeBackup(false);
  }
}
async function rotateBackups() {
  // 直近14個だけ残す
  try {
    const re = new RegExp(
      "^" +
        backupBaseName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "_backup_(\\d{4}-\\d{2}-\\d{2})\\.json$"
    );
    const files = [];
    for await (const [nm, h] of state.backupDirHandle.entries()) {
      const m = nm.match(re);
      if (m && h.kind === "file") files.push(nm);
    }
    files.sort();
    const drop = files.slice(0, Math.max(0, files.length - 14));
    for (const nm of drop) {
      try {
        await state.backupDirHandle.removeEntry(nm);
      } catch (_) {}
    }
  } catch (_) {}
}
async function onSetBackupDir() {
  if (!window.showDirectoryPicker) {
    alert("このブラウザはフォルダ選択に非対応です（Chrome/Edgeで）");
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({
      id: "yoyakuBackup",
      mode: "readwrite",
      startIn: "documents",
    });
    state.backupDirHandle = dir;
    await idbSet(BACKUP_DIR_KEY, dir);
    const ok = await writeBackup(true); // 設定直後に1本作る
    updateBackupStatus();
    toast(
      ok
        ? "バックアップ先を設定し、今のデータを1本保存しました"
        : "バックアップ先を設定しました"
    );
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("バックアップフォルダを設定できませんでした：" + e.message);
    }
  }
}
async function manualBackup() {
  if (!state.backupDirHandle) {
    onSetBackupDir();
    return;
  }
  const ok = await writeBackup(true);
  toast(
    ok ? "今のデータをバックアップしました" : "バックアップできませんでした（フォルダの許可を確認）"
  );
}
function updateBackupStatus() {
  const el = document.getElementById("backupStatus");
  if (!el) return;
  const last = localStorage.getItem("compe.lastBackup");
  el.textContent = state.backupDirHandle
    ? "設定済み" + (last ? "　最終バックアップ：" + last : "　（まだ未実行）")
    : "未設定";
}

async function askUpdatedBy() {
  if (state.updatedBy) return state.updatedBy;
  const v = prompt(
    "この端末の記録名（端末名・設置場所・使用者名など。例：フロント／事務所／支配人）\n更新履歴に「最終更新：○○」と残ります。設定からいつでも変更できます。",
    ""
  );
  if (v && v.trim()) {
    state.updatedBy = v.trim();
    localStorage.setItem("compe.updatedBy", state.updatedBy);
  }
  return state.updatedBy;
}
function saveUpdatedBy() {
  const el = document.getElementById("setUpdatedBy");
  if (!el) return;
  const v = (el.value || "").trim();
  state.updatedBy = v;
  if (v) localStorage.setItem("compe.updatedBy", v);
  else localStorage.removeItem("compe.updatedBy");
  if (typeof updateUpdatedChip === "function") updateUpdatedChip();
  toast(v ? "記録名を保存しました：" + v : "記録名を空にしました");
}

async function onOpenFile() {
  if (!FSA_SUPPORTED) {
    alert(
      "このブラウザはFile System Access API非対応です（Chrome/Edgeで開いてください）"
    );
    return;
  }
  try {
    // ファイル選択を最初に（クリック直後の操作有効時間を使う）。名前入力は後。
    const [h] = await window.showOpenFilePicker({
      id: "yoyakucheck",
      startIn: "documents",
      types: [{ description: "JSON台帳", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    await loadFromHandle(h);
    await idbSet(HANDLE_KEY, h);
    showReauth(false);
    await askUpdatedBy();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("ファイルを開けませんでした：" + e.message);
    }
  }
}

async function onNewFile() {
  if (!FSA_SUPPORTED) {
    alert(
      "このブラウザはFile System Access API非対応です（Chrome/Edgeで開いてください）"
    );
    return;
  }
  try {
    // 保存先選択を最初に（クリック直後の操作有効時間を使う）。名前入力は後。
    const h = await window.showSaveFilePicker({
      id: "yoyakucheck",
      startIn: "documents",
      suggestedName: "compe-yoyaku-izumisano.json",
      types: [{ description: "JSON台帳", accept: { "application/json": [".json"] } }],
    });
    await askUpdatedBy();
    state.fileHandle = h;
    state.fileName = h.name;
    state.dataLoadedFromFile = true;
    useRealToday(); // 新規台帳も当日基準
    // 空の正本を書き込む（誤上書き防止で空配列で初期化）
    state.rows = [];
    state.selIdx = -1;
    document.getElementById("demoNote")?.classList.add("hidden");
    state.isDirty = true;
    await saveToFile();
    await idbSet(HANDLE_KEY, h);
    showReauth(false);
    setFileStatus("" + state.fileName + "（新規作成）", "ok");
    toast("新規ファイルを作成しました");
    render();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("新規作成できませんでした：" + e.message);
    }
  }
}

async function onReauth() {
  if (!state.fileHandle) {
    onOpenFile();
    return;
  }
  const perm = await ensurePermission(state.fileHandle, "readwrite");
  if (perm === "granted") {
    showReauth(false);
    state.needsReauth = false;
    if (!state.dataLoadedFromFile) {
      // ブラウザ再起動後の復帰：まだ読み込んでいない＝最新データを読み込む（空での上書きを防止）
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      } // ★保留中の保存をキャンセル（未読込データでの上書きレースを防ぐ）
      state.isDirty = false;
      await loadFromHandle(state.fileHandle);
    } else if (state.isDirty) {
      // セッション中の権限切れからの復帰：保留していた変更を保存
      saveToFile();
    } else {
      setFileStatus("" + state.fileName + "（同期OK）", "ok");
    }
  } else {
    setFileStatus("🔒 許可されませんでした", "err");
  }
}

async function bootstrapFile() {
  if (!FSA_SUPPORTED) {
    setFileStatus("⚠ 非対応ブラウザ（メモリ動作）", "warn");
    return;
  }
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch (_) {} // ブラウザにデータ保持を要求（自動消去対策・終了時クリア設定は別途IT対応）
  try {
    state.backupDirHandle = (await idbGet(BACKUP_DIR_KEY)) || null;
    updateBackupStatus();
  } catch (_) {} // バックアップ先フォルダを復元
  try {
    const h = await idbGet(HANDLE_KEY);
    if (!h) {
      const last = (() => {
        try {
          return localStorage.getItem("compe.lastFileName");
        } catch (_) {
          return null;
        }
      })();
      if (last) {
        // 前回は接続できていたのにハンドルが消えている＝このPCは終了時にサイトデータを消す設定の可能性
        setFileStatus("未接続", "warn");
        const dn = document.getElementById("demoNote");
        if (dn) {
          dn.textContent =
            "右上の「開く」から前回のファイル（" + last + "）を選び直してください。";
          dn.classList.remove("hidden");
        }
      } else {
        setFileStatus("未接続（「開く」/ 設定で新規作成）", "warn");
      }
      return;
    }
    const q = await h.queryPermission({ mode: "readwrite" });
    if (q === "granted") {
      await loadFromHandle(h);
    } else {
      state.fileHandle = h;
      state.fileName = h.name || "data.json";
      state.dataLoadedFromFile = false;
      state.needsReauth = true;
      setFileStatus("🔒 再接続が必要", "warn");
      showReauth(true);
      const dn = document.getElementById("demoNote");
      if (dn) {
        dn.classList.add("hidden");
      }
      render(); // 中央に大きく「再接続する」ボタンを表示
    }
  } catch (e) {
    console.error(e);
    setFileStatus("⚠ 復元失敗（「開く」を押してください）", "err");
  }
}
// ===== Excel書き出し（現行台帳と同じ形式＝バックアップ＆再取込可能） =====
// ===== SMS配信リスト書き出し（SMSLINK一括配信用） =====
function smsNormPhone(s) {
  return (s || "").replace(/[^0-9]/g, "");
}
function smsIsMobile(s) {
  return /^(070|080|090)\d{8}$/.test(smsNormPhone(s));
}
function smsSurname(n) {
  const s = (n || "").trim();
  const i = s.search(/[\s　]/);
  return i > 0 ? s.slice(0, i) : s;
} // スペース前を姓に。会社名等はそのまま
function smsFilteredRows() {
  const routes = [...document.querySelectorAll(".smsRoute:checked")].map((c) => c.value);
  const past = document.getElementById("smsPast").checked;
  const exclC = document.getElementById("smsExclCancel").checked;
  const exclInb = document.getElementById("smsExclInbound").checked;
  const exclFor = document.getElementById("smsExclForeign").checked;
  const fromD = pd((document.getElementById("smsFrom").value || "").replace(/-/g, "/"));
  const toD = pd((document.getElementById("smsTo").value || "").replace(/-/g, "/"));
  return state.rows.filter((r) => {
    if (routes.length && !routes.includes(r.route)) return false;
    if (exclC && r.kk === "キャンセル") return false;
    if (exclInb && (r.inbound === "〇" || /インバウンド/.test(r.memo || ""))) return false;
    if (exclFor && smsIsForeignName(r.n)) return false;
    const pl = pd(r.play);
    if (past && (!pl || pl > state.TODAY)) return false;
    if (fromD && (!pl || pl < fromD)) return false;
    if (toD && (!pl || pl > toD)) return false;
    if (!smsIsMobile(r.mob)) return false;
    return true;
  });
}
// 外国名の判定：ローマ字/英字・ハングル・代表的な簡体字を検出（漢字名の韓国・中国は判別不可＝手動マークで対応）
function smsIsForeignName(n) {
  const s = n || "";
  if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(s)) return true; // ローマ字・英字（全半角）
  if (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(s)) return true; // ハングル
  if (/[张刘陈杨赵韩龙罗郑冯邓萧苏蒋贾顾卢钱孙马严华叶吕齐]/.test(s)) return true; // 主な簡体字（日本語に無い字形）
  return false;
}
function smsAggregate(list, dedupe) {
  if (!dedupe)
    return list.map((r) => ({
      mob: smsNormPhone(r.mob),
      n: r.n,
      play: r.play,
      course: r.course,
      route: r.route,
      cnt: 1,
    }));
  const map = new Map();
  list.forEach((r) => {
    const k = smsNormPhone(r.mob),
      pl = pd(r.play);
    if (!map.has(k))
      map.set(k, {
        mob: k,
        n: r.n,
        play: r.play,
        course: r.course,
        route: r.route,
        cnt: 1,
        _pl: pl,
      });
    else {
      const e = map.get(k);
      e.cnt++;
      if (pl && (!e._pl || pl > e._pl)) {
        e.n = r.n;
        e.play = r.play;
        e.course = r.course;
        e.route = r.route;
        e._pl = pl;
      }
    }
  });
  return [...map.values()];
}
function smsResult() {
  const list = smsFilteredRows();
  let agg = smsAggregate(list, document.getElementById("smsDedupe").checked);
  const minV = Math.max(1, parseInt(document.getElementById("smsMinVisits").value) || 1);
  if (minV > 1) agg = agg.filter((e) => e.cnt >= minV);
  return { list, agg, minV };
}
function smsPreview() {
  const { list, agg, minV } = smsResult();
  const extra = minV > 1 ? `・予約${minV}回以上` : "";
  document.getElementById("smsMsg").innerHTML =
    `該当 <b>${list.length}</b> 件 ／ 配信先（ユニーク携帯${extra}） <b>${agg.length}</b> 件`;
  return agg;
}
function smsExport() {
  if (typeof XLSX === "undefined") {
    toast("CSV機能の読み込みに失敗しました");
    return;
  }
  const { agg } = smsResult();
  if (!agg.length) {
    document.getElementById("smsMsg").innerHTML =
      '<span style="color:#b35900">該当する配信先がありません（携帯番号070/080/090がある人・条件一致が必要）</span>';
    return;
  }
  const aoa = [["携帯番号", "氏名", "姓", "最終プレー日", "コース", "経路", "予約回数"]];
  agg.forEach((e) =>
    aoa.push([e.mob, e.n, smsSurname(e.n), e.play, e.course, e.route, e.cnt])
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws); // UTF-8文字列
  let bytes,
    enc = "Shift-JIS";
  try {
    bytes = new Uint8Array(cptable.utils.encode(932, csv));
  } catch (e) {
    // 真のShift-JIS
    console.warn("sjis encode failed, fallback utf8", e);
    bytes = new TextEncoder().encode(csv);
    enc = "UTF-8";
  }
  const blob = new Blob([bytes], { type: "text/csv" });
  const n = new Date();
  const ymd =
    n.getFullYear() +
    String(n.getMonth() + 1).padStart(2, "0") +
    String(n.getDate()).padStart(2, "0");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "SMS配信リスト_" + ymd + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  document.getElementById("smsMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${agg.length} 件を書き出しました（SMSLINK用CSV・${enc}）</span>`;
  toast(agg.length + " 件のSMS配信リストを書き出しました");
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Excel機能の読み込みに失敗しました");
    return;
  }
  if (!state.rows.length) {
    toast("書き出すデータがありません");
    return;
  }
  const head = [
    "抽出日", "受付日", "プレー日", "曜日", "代表者氏名", "連絡先電話番号", "携帯電話番号",
    "コース名", "時間", "組数", "人数", "経路", "連絡可能時間帯", "①予約1日後", "②60日前",
    "③35日前", "④18日前", "出欠締切日", "組数確定", "備考", "組合せ入力",
  ];
  const aoa = [["予約チェック台帳（HTMLツール書き出し）"], head];
  state.rows.forEach((r) => {
    const s = r.s || ["", "", "", ""],
      d = r.d || ["", "", "", ""];
    aoa.push([
      "", r.recv || "", r.play || "", r.wd || "", r.n || "", r.tel || "", r.mob || "",
      r.course || "", r.time || "", r.g || "", r.p || "", r.route || "", "",
      s[0] || d[0] || "", s[1] || d[1] || "", s[2] || d[2] || "", s[3] || d[3] || "",
      "", r.kk || "", r.memo || "", r.kumi || "",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "予約チェック進捗確認シート");
  const n = new Date();
  const ymd =
    n.getFullYear() +
    String(n.getMonth() + 1).padStart(2, "0") +
    String(n.getDate()).padStart(2, "0");
  XLSX.writeFile(wb, "予約チェック_backup_" + ymd + ".xlsx");
  toast("Excelを書き出しました（" + state.rows.length + "件）");
}

// 他者更新の検知：タブに戻った時＋20秒ごと
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkExternal();
});
setInterval(() => {
  if (!document.hidden) checkExternal();
}, 20000);

window.addEventListener("load", () => {
  bootstrapFile();
  updateUpdatedChip();
});
window.addEventListener("beforeunload", (e) => {
  if (state.isDirty && state.fileHandle) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function pd(s) {
  const m = s && s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
// ===== 月別集計（純粋関数：DOM非依存） =====
function aggregateMonthly(rows) {
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
function renderStats() {
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
      "年</h3><table class=\"stbl\"><thead><tr>" +
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
function renderStrip() {
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
    "<button class=\"strip-link\" onclick=\"showScreen('stats')\">詳細 →</button>";
  host.innerHTML = html;
}
// 増減バッジ（+n / −n。0 は表示しない）
function statDelta(diff) {
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
function fmt(d) {
  return d
    ? d.getFullYear() +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(d.getDate()).padStart(2, "0")
    : "";
}
function addDays(d, n) {
  if (!d) return null;
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// コンタクトの日数ラベル。設定変更時に表示も自動で変わる
const CIRC = ["①", "②", "③", "④"];
function dayLabel(i) {
  return i === 0
    ? state.o1 === 1
      ? "受付翌日"
      : "受付" + state.o1 + "日後"
    : [0, state.o2, state.o3, state.o4][i] + "日前";
}
function rebuildLabels() {
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
function recompute() {
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
function actRound(r) {
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
function nextFuture(r) {
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
function isDeferred(r) {
  return !!r.next && pd(r.next) > state.TODAY && (r.s || []).includes("不在");
}
function isToday(r) {
  return actRound(r) >= 0 && !isDeferred(r);
}
function inTodayView(r) {
  return isToday(r) || r._touch;
}
function daysFrom(s) {
  const d = pd(s);
  return d ? Math.round((d - state.TODAY) / 86400000) : 0;
} // 正=未来, 負=過去
function mdOf(s) {
  return (s || "").replace(/^\d{4}\//, "");
}
function onSearch(v) {
  state.searchQ = v;
  render();
}
function needsContact(r, i) {
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
function visibleRows() {
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
    if (state.selIdx >= state.rows.length)
      state.selIdx = Math.max(0, state.rows.length - 1);
    toast("削除しました：" + r.n);
    markDirty();
    render();
  }
}

function render() {
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
      if (r.kk === "キャンセル") {
        due = "✕ キャンセル";
        cls = "carry";
      } else if ((r.kumi || "") === "済") {
        due = "✓ 完了（組合せ入力済）";
        cls = "done";
      } else if (state.excludeKakutei && r.kk === "〇") {
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
    } else if (r.s[a] === "不在") {
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
function editCell(gi, i) {
  const r = state.rows[gi],
    v = r.s[i];
  const disp =
    v === "〇"
      ? '<span class="pill green">〇</span>'
      : v === "不在"
        ? '<span class="pill red">不在</span>'
        : v === "不要"
          ? '<span style="color:#6b7280;font-weight:700">不要</span>'
          : '<span style="color:#374151">' + r.d[i] + "（予定）</span>";
  return `<div class="editcell"><span>${disp}</span><span class="sel-wrap">
    <button class="sb done ${v === "〇" ? "on-done" : ""}" onclick="setS(${gi},${i},'〇')">〇</button>
    <button class="sb zai ${v === "不在" ? "on-zai" : ""}" onclick="setS(${gi},${i},'不在')">不在</button>
    <button class="sb fuyo ${v === "不要" ? "on-fuyo" : ""}" onclick="setS(${gi},${i},'不要')">不要</button>
    <button class="sb undo" onclick="setS(${gi},${i},'')">空</button></span></div>`;
}
function renderDetail() {
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
  else if (r.s[a] === "不在")
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
     (r.s || []).includes("不在")
       ? `<div class="sec">次回連絡日（不在の再架電）</div>
   <div class="editcell"><span>${r.next ? "設定：" + r.next + "（その日まで今日やることから外します）" : "未設定（不在は毎日「今日やること」に表示）"}</span><span class="sel-wrap"><input type="date" class="datein" value="${r.next ? r.next.replace(/\//g, "-") : ""}" onchange="setNext(${gi},this.value)"><button class="sb" onclick="setNext(${gi},'')">クリア</button></span></div>`
       : ""
   }
   <div class="sec">メモ（連絡内容・申し送り）</div>
   <textarea oninput="setMemo(${gi},this.value)" placeholder="例）6/3 田中様へ連絡、組数は3組で確定見込み。次回6/15に再確認。" style="width:100%;height:84px;border:1px solid var(--line);border-radius:6px;padding:10px;font-size:13px;font-family:inherit">${(r.memo || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</textarea>
   <p style="color:#9aa1aa;font-size:12px;margin-top:14px">戻し方は2通り：①上部 <b>元に戻す</b> で直前操作を取消／②この詳細で各コンタクトを選び直し（<b>全件</b>表示にすれば完了済みの予約も探して修正できます）。「不在」は〇/不要にするまで繰越で残ります。</p>`;
}
function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function toast(m) {
  const t = document.getElementById("toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1900);
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(
      () => toast("コピーしました：" + t),
      () => fallbackCopy(t)
    );
  } else {
    fallbackCopy(t);
  }
}
function fallbackCopy(t) {
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
function showScreen(name) {
  const main = name === "main";
  document.getElementById("screenMain").classList.toggle("hidden", name !== "main");
  document.getElementById("screenImport").classList.toggle("hidden", name !== "import");
  document
    .getElementById("screenSettings")
    .classList.toggle("hidden", name !== "settings");
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
function setImpMode() {
  // 日次CSV取込画面の初期化（移行UIは設定メニューへ集約済み）
  const ta = document.getElementById("ta");
  if (ta) {
    ta.value = "";
  }
  const im = document.getElementById("impMsg");
  if (im) im.textContent = "";
  const df = document.getElementById("dzFile");
  if (df) df.textContent = "";
  const cf = document.getElementById("csvFile");
  if (cf) cf.value = "";
  state._migRows = null;
  const bm = document.getElementById("bMig");
  if (bm) bm.disabled = true;
  const xn = document.getElementById("xlsxName");
  if (xn) xn.textContent = "";
  const xf = document.getElementById("xlsxFile");
  if (xf) xf.value = "";
  const mm = document.getElementById("migMsg");
  if (mm) mm.textContent = "";
}

// ===== 既存Excel台帳の移行（SheetJS） =====
function xstat(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "不在" || s === "不要" ? s : "";
}
function xkk(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "〇" || s === "キャンセル" ? s : "";
}
function xkumi(v) {
  const s = (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
  return s === "済" ? "済" : "";
}
function xclean(v) {
  return (v == null ? "" : String(v)).replace(/['"]/g, "").trim();
}
function xdate(v) {
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
function xtime(v) {
  if (v == null) return "";
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, "0") + ":" + m[2] : String(v).trim();
}
function xnum(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^0-9]/g, ""));
  return isNaN(n) ? 0 : n;
}

function onXlsxPicked(input) {
  const f = input.files && input.files[0];
  if (!f) {
    return;
  }
  document.getElementById("xlsxName").textContent = "読み込み中… " + f.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
      const sheetName =
        wb.SheetNames.find((n) => n.indexOf("進捗") >= 0) ||
        wb.SheetNames.find((n) => n.indexOf("チェック") >= 0);
      if (!sheetName) {
        document.getElementById("migMsg").innerHTML =
          '<span style="color:#b91c1c">「進捗確認シート」が見つかりません。シート名をご確認ください。</span>';
        return;
      }
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        cellDates: true,
        defval: null,
      });
      const out = [];
      for (let i = 2; i < aoa.length; i++) {
        // 3行目(index2)からデータ
        const r = aoa[i];
        if (!r) continue;
        const name = xclean(r[4]);
        if (!name) continue;
        const recv = xdate(r[1]),
          play = xdate(r[2]);
        const memoV = xclean(r[19]);
        out.push({
          n: name,
          play,
          wd: xclean(r[3]),
          course: xclean(r[7]),
          time: xtime(r[8]),
          g: xnum(r[9]),
          p: xnum(r[10]),
          route: xclean(r[11]),
          recv,
          d: ["", "", "", ""],
          s: [xstat(r[13]), xstat(r[14]), xstat(r[15]), xstat(r[16])],
          kk: xkk(r[18]),
          kumi: xkumi(r[20]),
          memo: memoV,
          inbound: /インバウンド/.test(memoV) ? "〇" : "", // 備考に記載があれば自動でマーク
          tel: xclean(r[5]),
          mob: xclean(r[6]),
        });
      }
      if (!out.length) {
        document.getElementById("migMsg").innerHTML =
          '<span style="color:#b91c1c">有効な行が見つかりませんでした。</span>';
        return;
      }
      state._migRows = out;
      document.getElementById("xlsxName").textContent =
        "✅ " + f.name + "（シート「" + sheetName + "」）";
      document.getElementById("bMig").disabled = false;
      const cancel = out.filter((x) => x.kk === "キャンセル").length;
      document.getElementById("migMsg").innerHTML =
        `<b>${out.length}</b> 件を読み込みました（うちキャンセル ${cancel} 件）。` +
        `①〜④の対応状況・組数確定・備考も引き継ぎます。` +
        `<br><span style="color:#b35900;font-weight:700">「台帳へ移行」を押すと、現在のデータは全て置き換わります。</span>`;
    } catch (err) {
      console.error(err);
      document.getElementById("migMsg").innerHTML =
        '<span style="color:#b91c1c">読み込みエラー：' + (err.message || err) + "</span>";
    }
  };
  reader.onerror = () => {
    document.getElementById("migMsg").innerHTML =
      '<span style="color:#b91c1c">ファイルを読めませんでした。</span>';
  };
  reader.readAsArrayBuffer(f);
}

function migrate() {
  if (!state._migRows || !state._migRows.length) {
    document.getElementById("migMsg").textContent = "先にExcelファイルを選択してください";
    return;
  }
  if (
    state.rows.length &&
    !confirm(
      "現在の " +
        state.rows.length +
        " 件を、Excelの " +
        state._migRows.length +
        " 件で置き換えます。よろしいですか？\n（この操作の前のデータには、OneDrive/共有のファイル履歴から戻せます）"
    )
  )
    return;
  const n = state._migRows.length;
  state.rows = state._migRows.map((r) => ({ ...r, d: [...r.d], s: [...r.s] }));
  recompute(); // ①〜④予定日を受付/プレー＋設定日数から計算
  state.dataLoadedFromFile = true;
  state.needsReauth = false;
  state.lastKnownCount = state.rows.length; // 移行データは正本＝保存可能に
  state.selIdx = -1;
  state._migRows = null;
  document.getElementById("bMig").disabled = true;
  document.getElementById("migMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${n} 件を移行しました。「← 一覧へ戻る」で確認できます（自動保存）。</span>`;
  markDirty();
  toast(n + " 件を移行しました");
  render();
}
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
function dzOver(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("over");
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}
function dzLeave(e) {
  if (e.target.id === "dropZone")
    document.getElementById("dropZone").classList.remove("over");
}
function dzDrop(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.remove("over");
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) {
    readCsvFile(dt.files[0]);
    return;
  }
  const t = dt.getData && dt.getData("text");
  if (t) {
    document.getElementById("ta").value = t;
    document.getElementById("dzFile").textContent = "";
    extract();
  }
}
function onCsvFile(input) {
  const f = input.files && input.files[0];
  if (f) {
    readCsvFile(f);
    input.value = "";
  }
}
function readCsvFile(f) {
  if (!/\.(csv|txt)$/i.test(f.name)) {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c">CSV(.csv)またはテキスト(.txt)を選んでください</span>';
    return;
  }
  document.getElementById("dzFile").textContent = "読み込み中… " + f.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const buf = e.target.result;
    let text = "";
    try {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } catch (_) {}
    if (!/プレー日|代表者|受付|予約/.test(text)) {
      try {
        text = new TextDecoder("shift-jis").decode(buf);
      } catch (_) {}
    }
    document.getElementById("ta").value = text;
    document.getElementById("dzFile").textContent =
      "読み込み済み：" +
      f.name +
      "（" +
      text.split(/\r?\n/).filter((l) => l.trim()).length +
      "行）";
    extract();
  };
  reader.onerror = () => {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c">ファイルを読めませんでした</span>';
  };
  reader.readAsArrayBuffer(f);
}

// ===== CSV取込（実データ処理） =====
const WD = ["日", "月", "火", "水", "木", "金", "土"];
function cellClean(s) {
  return (s || "")
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .trim();
}
function normRoute(s) {
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
function parseDate(s) {
  const m = (s || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function fmtSlash(d) {
  return d
    ? d.getFullYear() +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(d.getDate()).padStart(2, "0")
    : "";
}
function cleanName(s) {
  return cellClean(s).replace(/代表者名/g, "").trim();
}

// CSV行を rows[] スキーマのオブジェクトへ。列順: 0場名1種別2プレー日3コース4時間5氏名6カナ7組数8人数9連絡先10携帯11FAX12経路13受付日時...
function parseRow(c) {
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

function extract() {
  const t = document.getElementById("ta").value.trim();
  if (!t) {
    document.getElementById("impMsg").textContent = "CSVを貼り付けてください";
    return;
  }
  const lines = t
    .split(/\r?\n/)
    .filter((l) => l.trim() && l.indexOf("プレー日") < 0);
  let total = 0,
    ge3 = 0,
    future = 0;
  const cand = [];
  lines.forEach((l) => {
    total++;
    const c = l.split(",");
    const r = parseRow(c);
    if (r.g < 3) return;
    ge3++;
    if (!r._playDt || r._playDt < state.TODAY) return;
    future++;
    if (!r.n) return;
    cand.push(r);
  });
  // CSV内重複排除（プレー日+氏名+経路）
  const seen = new Set(),
    uniq = [];
  cand.forEach((r) => {
    const k = r.play + "|" + r.n + "|" + r.route;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(r);
    }
  });
  // 既存台帳と照合（プレー日+氏名が一致＝既存）→新規のみ
  const fresh = uniq.filter(
    (r) => !state.rows.some((ex) => ex.n === r.n && ex.play === r.play)
  );
  const dupExisting = uniq.length - fresh.length;
  fresh.forEach((r) => {
    delete r._playDt;
  });
  state._pendingImport = fresh;
  document.getElementById("impMsg").innerHTML =
    `抽出 <b>${uniq.length}</b> 件（3組以上・未来日・重複除外後）／ うち新規 <b>${fresh.length}</b> 件` +
    `<br><span style="color:#9ca3af;font-size:12px">読込${total}行 → 3組以上${ge3} → 未来日${future} → 重複/既存除外 ${uniq.length - fresh.length}件（既存台帳と重複 ${dupExisting}件）</span>` +
    (fresh.length
      ? `<br>内容を確認して『台帳へ登録』を押してください`
      : `<br><span style="color:#b35900">新規はありません（全て登録済み or 条件外）</span>`);
  document.getElementById("bReg").disabled = fresh.length === 0;
}
function register() {
  // ★未接続/未読込のまま取り込むと、再接続時に少数の取込分で台帳が全消しされる事故になる。先に接続を必須化
  if (FSA_SUPPORTED && (!state.fileHandle || !state.dataLoadedFromFile)) {
    document.getElementById("impMsg").innerHTML =
      '<span style="color:#b91c1c;font-weight:700">先に台帳ファイルに接続してください。</span><br>上部の「再接続する」または「開く」で台帳を開いてから取り込みます（接続前に取り込むとデータが失われます）。';
    return;
  }
  if (!state._pendingImport.length) {
    document.getElementById("impMsg").textContent =
      "先にCSVを取り込んでください（ドロップ・ファイル選択・貼り付け）";
    return;
  }
  const n = state._pendingImport.length;
  state._pendingImport.forEach((r) => state.rows.push(r));
  recompute(); // ①〜④予定日を計算
  state._pendingImport = [];
  document.getElementById("ta").value = "";
  document.getElementById("bReg").disabled = true;
  document.getElementById("impMsg").innerHTML =
    `<span style="color:#1a7f37;font-weight:700">${n} 件を台帳に登録しました（自動保存）。『一覧へ戻る』で確認できます</span>`;
  markDirty();
  toast(n + " 件を登録しました");
  render();
}

// ===== onclick属性ハンドラ用に window へ公開（Phase 4 で addEventListener 化予定） =====
// テスト用フック __state も併せて公開する。
Object.assign(window, {
  // 状態フック
  __state: state,
  // FSA / 保存
  reloadFromFile,
  onOpenFile,
  onNewFile,
  onReauth,
  onSetBackupDir,
  manualBackup,
  saveUpdatedBy,
  exportExcel,
  // SMS
  smsPreview,
  smsExport,
  // 集計・ストリップ
  renderStrip,
  renderStats,
  // 一覧操作
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
  // 取込・移行
  dzOver,
  dzLeave,
  dzDrop,
  onCsvFile,
  extract,
  register,
  onXlsxPicked,
  migrate,
  // テスト互換: applyJson と TODAY 互換アクセサ
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
