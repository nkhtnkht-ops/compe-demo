// アプリ全域で使う定数。
// 値の文字列/数値は保存JSONや表示文言と同一なので変更しないこと。

// ===== ステータス文字列（r.s[i] の値）=====
export const ST = {
  MARU:    "〇",      // 対応済
  FUZAI:   "不在",   // 不在（繰越）
  FUYO:    "不要",   // 不要（スキップ）
};

// ===== フィールド値（r.kk / r.kumi）=====
export const KK = {
  MARU:    "〇",      // 組数確定
  CANCEL:  "キャンセル",
};
export const KUMI = {
  ZUMI:    "済",      // 組合せ入力済
};

// ===== タイミング・閾値 =====
/** 他者更新検知で自分の最終書込 mtime に加えるバッファ（ms）。OneDrive 同期遅延を考慮 */
export const EXTERNAL_CHANGE_BUFFER_MS = 1500;

/** 自動バックアップの最小間隔（ms）。同日内に連続保存するのを抑制 */
export const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5分

/** バックアップを保持する世代数（日付単位） */
export const BACKUP_KEEP_COUNT = 14;

/** 他者更新の定期チェック間隔（ms） */
export const EXTERNAL_CHECK_INTERVAL_MS = 20000; // 20秒

/** トースト表示時間（ms） */
export const TOAST_DURATION_MS = 1900;

/** 直前操作の警告しきい値（分）: 他者が X 分以内に更新していたら重複編集警告 */
export const RECENT_OP_WARN_MINS = 10;

/** 激減検知しきい値: lastKnownCount がこの値以上の場合に判定する */
export const DRASTIC_REDUCE_MIN_COUNT = 20;

/** 激減検知しきい値: 保存件数が lastKnownCount の何分の1未満で警告するか（分母） */
export const DRASTIC_REDUCE_DENOM = 2;

// ===== CSV列インデックス（parseRow）=====
// 列順: 0場名 1種別 2プレー日 3コース 4時間 5氏名 6カナ 7組数 8人数 9連絡先 10携帯 11FAX 12経路 13受付日時
export const CSV_COL = {
  VENUE:    0,
  TYPE:     1,
  PLAY:     2,
  COURSE:   3,
  TIME:     4,
  NAME:     5,
  KANA:     6,
  GROUPS:   7,
  PEOPLE:   8,
  TEL:      9,
  MOB:      10,
  FAX:      11,
  ROUTE:    12,
  RECV:     13,
};

// ===== Excel列インデックス（onXlsxPicked: aoa[i][j] の j）=====
// 進捗確認シートの列配置（0始まり）
export const XLS_COL = {
  RECV:     1,
  PLAY:     2,
  WEEKDAY:  3,
  NAME:     4,
  TEL:      5,
  MOB:      6,
  COURSE:   7,
  TIME:     8,
  GROUPS:   9,
  PEOPLE:   10,
  ROUTE:    11,
  S0:       13,
  S1:       14,
  S2:       15,
  S3:       16,
  KK:       18,
  MEMO:     19,
  KUMI:     20,
};
