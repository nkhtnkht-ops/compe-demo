# compe-demo 完全リファクタリング計画

作成日: 2026-06-10 ／ 対象: `index.html`（1230行・単一ファイルアプリ）および周辺ファイル

## 0. 前提と制約（プラン全体を縛るもの）

| 制約 | 内容 | プランへの影響 |
|---|---|---|
| 本番直結 | GitHub Pages が main を直接配信。push ＝ 即デプロイ | 作業は必ずブランチで行い、小さく分けて main にマージする |
| ビルド環境なし | package.json なし、Node 非依存の運用。guide-brief.md も「単一HTML推奨」 | **ランタイムはノービルドを維持**。ES Modules ＋ 複数ファイル分割は GitHub Pages でビルド不要のまま動くので、これを採用。Node はテスト/lint 専用（devDependencies のみ） |
| 実データの重み | 共有ドライブ上の JSON 台帳が正本。過去に全消し事故（54e649a で対策済）あり | 保存系を触るフェーズは最後ではなく**テスト整備直後**に置く。検証は必ずダミー台帳で行い、実台帳に接続したテストは禁止 |
| 社用PCカットオーバー未了 | 本番利用の立ち上げ中。自宅環境はUI調整のみの運用ルール | Phase 0–2（挙動不変）はいつでも可。Phase 3 以降（挙動に触れる）は**カットオーバー安定後**に着手するのが安全 |
| ブラウザ前提 | File System Access API 必須（Chrome/Edge）。SJIS(CP932) 出力に SheetJS full ビルドが必要 | xlsx.full.min.js は当面維持（mini 版は CP932 encode 不可）。バージョンだけ明示する |

**不変条件（全フェーズ共通の合格基準）:**
- 保存される JSON のスキーマ（schemaVersion:1）と Excel/CSV 入出力の列順は変えない
- 各フェーズ完了時点でアプリは完全に動作する（フェーズ途中で main にマージしない）
- データ破壊につながる変更は、対応するテストが先に存在すること

---

## Phase 0: 安全網と衛生（挙動変更ゼロ）

目的: 以降のフェーズを安全に進めるための足場。これ自体はユーザーに見える変化なし。

1. **リポジトリ掃除**
   - `powerapps-look.html` を削除（初期コミット以降未更新・どこからも参照なし・Pages上で古いUIを公開し続けている）
   - `README.md` 新設: アプリ概要、デプロイ方式（Pages直配信であることの明記）、SheetJS のバージョンと由来、開発手順
2. **開発インフラ導入（devのみ）**
   - `package.json`（private）: vitest（ユニットテスト）、eslint ＋ prettier、@playwright/test（スモーク）
   - `.editorconfig`、`.gitignore` に node_modules 追加
3. **スモークテスト（モノリスのまま動く特性化テスト）**
   - Playwright で: 起動→ダミー台帳読込→今日/全件切替→ステータス変更→undo→CSV取込プレビュー→Excel書き出し、の主要フローが死なないことを検証
   - `tests/fixtures/` にダミー台帳 JSON・サンプル CSV を用意（実データは絶対に入れない）
4. **CI**: GitHub Actions で PR 時に lint ＋ vitest ＋ Playwright を実行（Pages 配信には無関係なので安全に追加できる）

**完了条件:** CI が緑。アプリの差分は powerapps-look.html 削除のみ。
**目安規模:** 小（半日〜1日相当）

---

## Phase 1: モジュール分割（挙動変更ゼロの構造化）

目的: 1230行モノリスを、ノービルドの ES Modules に分割。テスト可能にする。

```
index.html        … HTML骨格のみ（~250行）
style.css         … <style> 120行をそのまま外出し
js/main.js        … エントリ。初期化と画面切替
js/constants.js   … ステータス文字列('〇'/'不在'/'不要'/'キャンセル'/'済')、
                     マジックナンバー(1500ms/14日/20000ms/閾値20/5分 等)、CSV/Excel列マップ
js/dateutil.js    … 日付パース/フォーマットの一本化先（Phase 2 で統合）
js/domain.js      … recompute、actRound/nextFuture/needsContact/isToday/isDeferred、visibleRows
js/storage.js     … FSA・IndexedDB・localStorage・バックアップ・他者更新検知（load/save/backup/conflict）
js/importers.js   … CSV取込(parseRow/extract/register)・Excel移行(onXlsxPicked/migrate)
js/exporters.js   … exportExcel・smsExport（SJIS出力）
js/render.js      … render/renderDetail/editCell/routeSelect
```

進め方（依存の少ない順に1ファイルずつ。各ステップでスモーク確認）:
1. style.css と constants.js（リスク最小）
2. dateutil.js / domain.js（純粋関数 → ここから vitest のユニットテストを書き始める。**現状の挙動をそのまま固定する特性化テスト**。バグも一旦そのまま固定し、修正は Phase 2 以降で）
3. importers.js / exporters.js
4. storage.js（最重要・最後に慎重に）
5. render.js と main.js

**インラインイベントハンドラの扱い:** `onclick="setMode(false)"` 型の属性ハンドラが多数あるため、Phase 1 では `main.js` から必要関数を `window` に明示的にぶら下げる（`Object.assign(window, {setMode, ...})`）。属性ハンドラ → addEventListener への置換は Phase 4 で行う（一度に両方やらない）。

**完了条件:** 全機能が分割前と同一に動作（Playwright 緑）。dateutil/domain/importers に特性化テストが付き、カバレッジの土台ができている。
**目安規模:** 中（2〜3日相当）。最大リスクは storage.js の切り出し → ダミー台帳での保存・バックアップ・権限再付与の手動確認も併用。

---

## Phase 2: 重複排除とデッドコード削除（ロジック統一）

目的: バグの温床になっている多重実装を1本化する。テストがあるので安全に潰せる。

1. **日付処理の一本化（最優先・効果最大）**
   - `pd`/`parseDate`（同一ロジック2重）、`fmt`/`fmtSlash`/`xdate`/`todayStr`/`ymd`生成（4〜5重）を dateutil.js の `parseDate()` / `formatSlash()` / `formatYmd()` に統合
   - null/不正日付の扱いを1箇所で定義（Phase 3 の警告表示の布石）
2. **追跡終了条件の述語化**: `actRound`/`nextFuture`/`needsContact` に3重コピペされている `(r.kumi==='済'||r.kk==='キャンセル'||...)` を `isTrackingEnded(r)` に抽出
3. **セルクリーン系統合**: `cellClean`/`xclean`/`xstat`/`xkk`/`xkumi` を importers 内の共通正規化関数へ
4. **デッドコード削除**:
   - `toggleMode`（未参照）
   - `setImpMode` の未使用引数
   - `applyJson` 内の `setCourse`/`setList` 参照（対応DOMが存在せず常に空振り）
   - exportExcel の常に空の3列は **削除しない**（列順互換の不変条件）。代わりにコメントで「互換のため空固定」と明示
5. **ステータスボタンHTML重複**（render 内と editCell）を共通の生成関数へ

**完了条件:** ユニットテスト全緑 ＋ Playwright 緑。日付・判定ロジックの実装が各1つ。
**目安規模:** 小〜中（1〜2日相当）

---

## Phase 3: データ層の堅牢化（ここから挙動が変わる。カットオーバー安定後に着手）

目的: 実害リスクが最も高い「保存の安全装置」と「取込パイプライン」を強化する。

1. **保存安全装置の穴埋め**
   - 激減検知の閾値穴を修正: 現在は `lastKnownCount>=20 かつ 半分未満` のみ警告 → **19件以下の台帳や半分弱への減少は無警告**。「N件以上の減少 or X%以上の減少」の二段判定に変更し、確認ダイアログを出す
   - 他者更新検知の固定 1500ms バッファを定数化し、OneDrive 同期遅延を考慮した判定（mtime＋サイズ併用）を検討
   - storage.js に対する保存レース（isSaving/isDirty/suspendDirty）のユニットテストを整備
2. **CSV取込の堅牢化**
   - 素朴な `split(',')` を引用符対応パーサに置換（氏名・コース名内のカンマで列ズレする現行バグの解消）
   - 列位置ハードコードを constants.js の列マップに集約し、**ヘッダ検証**を追加（期待した見出しがない場合は取込を中止してエラー表示。現在は黙って崩れる）
   - 文字コード判定（UTF-8→SJISフォールバック）のヒューリスティックを明示化し、判定結果をプレビューに表示
3. **Excel移行の堅牢化**: データ開始行の固定 index 依存をヘッダ探索に変更。表記揺れ（全角〇等）で対応履歴が静かに消える問題に、移行プレビューで「変換できなかった値」の警告一覧を出す
4. **日付欠損のサイレント漏れ対策**: `pd()` が null の行が「対応不要」に見える問題 → 一覧で「日付不備」バッジを表示して可視化

**完了条件:** 上記すべてにテストあり。ダミー台帳での破壊シナリオ（途中切断・二重保存・激減保存）が想定通りブロックされる。
**目安規模:** 中（2〜3日相当）。**このフェーズは1項目ずつ別PRでマージする**（保存系の変更を混ぜない）。

---

## Phase 4: レンダリングとUX（既知の痛点解消）

目的: 全再描画方式に起因する問題の解消と、イベント処理の近代化。

1. `render`（52行）/`renderDetail`（56行）を「行アイテム生成」「dueラベル計算」「コントロール生成」に分解
2. 編集系操作での全 `innerHTML` 再構築をやめ、対象行のみ更新 → **入力中フォーカス喪失の解消**（メモ編集だけ render を呼ばない場当たり対応が既に入っている＝既知の痛点）
3. インライン `onclick` 属性を撤廃し、リスト/詳細コンテナでのイベントデリゲーションに統一 → `window` への関数ぶら下げ（Phase 1 の暫定措置）を解消
4. 設定・SMS画面のインラインstyleを style.css のクラスへ移動

**完了条件:** Playwright 緑 ＋ 手動確認（編集中のフォーカス維持、undo、画面切替）。
**目安規模:** 中（2日相当）

---

## Phase 5: help同期コストの削減と仕上げ

目的: 「本体を変えるたびに help を手で直す」構造（同期必要箇所30+）の緩和と残課題の回収。

1. **デザイントークンの共有**: 色・ピル形状・バッジ定義を `tokens.css` に切り出し、index.html と help/index.html の双方から読み込む（help の1228行CSSの大半を削減）
2. **同期チェックリストの機械化**: ボタン文言・設定項目名・デフォルト日数・連絡先メールなど help が再現している文言の一覧を `docs/help-sync.md` に列挙し、本体変更時のチェックリスト化（自動生成は過剰なので手動リスト＋CIでの文言grep程度に留める）
3. **PWAの整合**: manifest はあるが Service Worker 未登録 → オフラインキャッシュが本当に必要かを判断し、不要なら現状維持を README に明記、必要なら最小限の SW を追加
4. **SheetJS**: バージョンを README に明示。CP932 出力が必要なため full ビルド維持が結論になる見込みだが、更新手順（公式からの差し替え方法）を文書化

**完了条件:** help と本体で色・形が単一ソース化。運用ドキュメント完備。
**目安規模:** 小〜中（1〜2日相当）

---

## 実行体制（オーケストレーション方針）

- 設計・コードレビュー・マージ判断: メインセッション（Fable 5）
- 実装: サブエージェントに委譲
  - Phase 0, 2, 5 → Sonnet（定型的・機械的な抽出/削除/文書化）
  - Phase 1 の storage.js 切り出し、Phase 3 全体、Phase 4 の差分描画 → Opus（保存安全・状態管理が絡む高難度部分）
- 各フェーズ＝1ブランチ（Phase 3 のみ項目ごとに分割）。マージ前に Fable 5 が差分監査 ＋ Playwright/vitest 緑を確認

## リスクと中断基準

- **最大リスクは Phase 1 の storage.js 切り出しと Phase 3 の保存系変更**。ここで実台帳に異常が出た場合は即 `git revert`（Pages は main 直配信なので revert ＝ 即ロールバック）
- カットオーバー前に着手してよいのは Phase 0–2（挙動不変＋テストで担保）。Phase 3 以降は本番運用が安定してから
- 各フェーズは独立して価値があるため、途中でやめても負債が増えない順序にしてある
