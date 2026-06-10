// 永続化モジュール：File System Access API・IndexedDB・自動バックアップ・他者更新検知・
// JSON シリアライズ（buildJson/applyJson）・読込/保存/再付与/起動復元。
// 依存方向：storage → render（toast/render/rebuildLabels）/ domain（recompute）/ dateutil（todayStr）/ state。
// render 側は storage を import しない（一方向）。XLSX 等の window グローバルは使用しない。
// ロジックは1文字も変更しない（buildJson の schemaVersion・列順・保存安全装置はそのまま）。
import { state, FSA_SUPPORTED } from "./state.js";
import { todayStr } from "./dateutil.js";
import { recompute } from "./domain.js";
import { render, toast, rebuildLabels } from "./render.js";
import {
  EXTERNAL_CHANGE_BUFFER_MS,
  SAVE_DEBOUNCE_MS,
  BACKUP_INTERVAL_MS,
  BACKUP_KEEP_COUNT,
  EXTERNAL_CHECK_INTERVAL_MS,
  RECENT_OP_WARN_MINS,
  DRASTIC_REDUCE_MIN_COUNT,
  DRASTIC_REDUCE_DENOM,
} from "./constants.js";

export const SCHEMA_VERSION = 1;

// 実ファイル接続時は当日基準へ切替（デモ基準日 state.TODAY を上書き）
export function useRealToday() {
  const n = new Date();
  state.TODAY = new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// ===== File System Access API + IndexedDB（ファイルハンドル永続化） =====
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
export function updateUpdatedChip() {
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
export async function reloadFromFile() {
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
export async function checkExternal() {
  if (!state.fileHandle || state.isSaving || state.externalChange) return;
  try {
    const f = await state.fileHandle.getFile();
    if (f.lastModified > state.lastWrittenMtime + EXTERNAL_CHANGE_BUFFER_MS) {
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
// 未使用だが Phase 1 では削除しない（デッドコード除去は Phase 2）。export で lint 上は参照済み扱い。
export async function idbDel(k) {
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

export function buildJson() {
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

export function applyJson(data) {
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
  // s.courseName / s.listName は buildJson に含まれず対応 DOM も存在しないため参照しない（Phase 2 で削除）
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

export async function loadFromHandle(handle) {
  state.suspendDirty = true;
  try {
    const file = await handle.getFile();
    const text = await file.text();
    const data = text.trim() ? JSON.parse(text) : { schemaVersion: SCHEMA_VERSION, rows: [] };
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
      if (mins >= 0 && mins < RECENT_OP_WARN_MINS) {
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

export async function saveToFile() {
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
  if (state.lastKnownCount >= DRASTIC_REDUCE_MIN_COUNT && state.rows.length < state.lastKnownCount / DRASTIC_REDUCE_DENOM) {
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
      if (cur.lastModified > state.lastWrittenMtime + EXTERNAL_CHANGE_BUFFER_MS) {
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
    await w.write(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
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
  state.saveTimer = setTimeout(saveToFile, SAVE_DEBOUNCE_MS);
}

export function markDirty() {
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
    await w.write(new Blob([JSON.stringify(buildJson(), null, 2)], { type: "application/json" }));
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
  // 新しい日付なら必ず、同日内はBACKUP_INTERVAL_MSに1回まで
  const lastDay = (localStorage.getItem("compe.lastBackup") || "").slice(0, 10);
  if (lastDay !== todayStr() || Date.now() - state.lastBackupTime > BACKUP_INTERVAL_MS) {
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
    const drop = files.slice(0, Math.max(0, files.length - BACKUP_KEEP_COUNT));
    for (const nm of drop) {
      try {
        await state.backupDirHandle.removeEntry(nm);
      } catch (_) {}
    }
  } catch (_) {}
}
export async function onSetBackupDir() {
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
      ok ? "バックアップ先を設定し、今のデータを1本保存しました" : "バックアップ先を設定しました"
    );
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("バックアップフォルダを設定できませんでした：" + e.message);
    }
  }
}
export async function manualBackup() {
  if (!state.backupDirHandle) {
    onSetBackupDir();
    return;
  }
  const ok = await writeBackup(true);
  toast(
    ok ? "今のデータをバックアップしました" : "バックアップできませんでした（フォルダの許可を確認）"
  );
}
export function updateBackupStatus() {
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
export function saveUpdatedBy() {
  const el = document.getElementById("setUpdatedBy");
  if (!el) return;
  const v = (el.value || "").trim();
  state.updatedBy = v;
  if (v) localStorage.setItem("compe.updatedBy", v);
  else localStorage.removeItem("compe.updatedBy");
  if (typeof updateUpdatedChip === "function") updateUpdatedChip();
  toast(v ? "記録名を保存しました：" + v : "記録名を空にしました");
}

export async function onOpenFile() {
  if (!FSA_SUPPORTED) {
    alert("このブラウザはFile System Access API非対応です（Chrome/Edgeで開いてください）");
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

export async function onNewFile() {
  if (!FSA_SUPPORTED) {
    alert("このブラウザはFile System Access API非対応です（Chrome/Edgeで開いてください）");
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

export async function onReauth() {
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

export async function bootstrapFile() {
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
          dn.textContent = "右上の「開く」から前回のファイル（" + last + "）を選び直してください。";
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

// ブラウザ時のみ起動時の常駐リスナーを登録（ユニットテストの import 時 no-op）。
// 登録内容・タイミングはブラウザでは従来と同一。
if (typeof document !== "undefined" && typeof window !== "undefined") {
  // 他者更新の検知：タブに戻った時＋20秒ごと
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkExternal();
  });
  setInterval(() => {
    if (!document.hidden) checkExternal();
  }, EXTERNAL_CHECK_INTERVAL_MS);

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
}
