// 共有可変状態（単一の state オブジェクトに集約）
// 各モジュールは `import { state } from './state.js'` で state.rows のように参照する。
// ※ ロジックは Phase 1 では一切変更しない。元のグローバル変数を state. プレフィックスへ機械的に移しただけ。

export const state = {
  // ===== 基準日・ラベル =====
  TODAY: new Date(2026, 5, 3), // デモ基準日。実ファイル接続時は useRealToday() で当日へ切替
  lbl: ["①受付翌日", "②60日前", "③35日前", "④18日前"], // 設定(o1〜o4)に応じて rebuildLabels() で動的更新

  // ===== File System Access API + IndexedDB（ファイルハンドル永続化） =====
  backupDirHandle: null, // 日付付きバックアップの保存先フォルダ
  lastBackupTime: 0, // バックアップ書込のスロットル用
  fileHandle: null,
  fileName: "",
  isDirty: false,
  saveTimer: null,
  isSaving: false,
  suspendDirty: false, // 読み込み中などはdirtyにしない
  // localStorage はブラウザでは常に存在。ユニットテスト（node, DOM無し）での読込のみ防御
  updatedBy:
    (typeof localStorage !== "undefined" && localStorage.getItem("compe.updatedBy")) || "",
  dataLoadedFromFile: false, // trueならJSONが正本（falseの間は絶対に保存しない＝未読込での上書き事故防止）
  lastKnownCount: -1, // 直近で読込/保存した件数。激減保存の検知用
  lastWrittenMtime: 0, // 自分が最後に書いた時のファイル更新時刻
  needsReauth: false, // 権限再付与が必要
  externalChange: false, // 他の人がファイルを更新したか
  loadedUpdatedAt: "",
  loadedUpdatedBy: "",

  // ===== 設定 =====
  o1: 1,
  o2: 60,
  o3: 35,
  o4: 18, // ①受付+o1日 / ②③④はプレー日のo2,o3,o4日前
  excludeKakutei: true, // 組数確定〇で「今日やること」から除外
  todayTouch: [true, true, true, true], // ①〜④を「今日やること」に表示するか

  // ===== 台帳データ・一覧表示状態 =====
  rows: [],
  showAll: false,
  selIdx: -1,
  undoStack: [],
  sortKey: "play",
  searchQ: "",
  contactFilter: "",

  // ===== 取込・移行の一時データ =====
  _migRows: null,
  _pendingImport: [],
};
