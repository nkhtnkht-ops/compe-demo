# ゴルフコンペ予約チェック管理

ゴルフ場のコンペ予約を一元管理するシングルページアプリ。  
受付から組合せ入力までの追客コンタクト（①受付翌日・②60日前・③35日前・④18日前）を一覧・状態管理します。

## 特徴

- **ノービルド・ES Modules**: ビルド工程なしで動作。`index.html`（HTML骨格）＋ `style.css` ＋ `js/` 配下の ES Modules で構成。GitHub Pages が無変換で直配信
- **File System Access API**: 共有ドライブ（OneDrive 等）上の JSON 台帳ファイルをブラウザから直接読み書き
- **ブラウザ**: Chrome / Edge 必須（File System Access API が必要）
- **SMS 配信リスト書き出し**: SMSLINK 一括配信用 CSV を CP932（Shift-JIS）で出力

## デプロイ方式

GitHub Pages が `main` ブランチを **ビルドなしで直接配信**しています。

```
push to main = 即本番反映
```

**本番 URL**: <https://nkhtnkht-ops.github.io/compe-demo/>

> **注意**: 作業は必ずブランチで行い、レビュー後に main へマージしてください。

## 同梱ライブラリ

| ファイル | 内容 | バージョン |
|---|---|---|
| `xlsx.full.min.js` | SheetJS の **full build** | cptable 1.15.0 同梱 |

> **full build が必須な理由**: SMS 配信リスト書き出しで CP932（Shift-JIS）エンコードが必要なため、`mini` ビルド（CP932 encode 不可）では動作しません。

## 開発手順

テスト・lint のみ Node.js が必要です。

```bash
npm install          # devDependencies のインストール
npm run lint         # ESLint（js/ ＋ tests/）
npm test             # Vitest ユニットテスト
npm run test:e2e     # Playwright スモークテスト（Chrome / Chromium）
npm run fmt          # Prettier（js/ ＋ tests/）
```

### ローカルでの動作確認

ES Modules（`<script type="module">`）を使用しているため、**`file://` で index.html を直接開いても動きません**（モジュール読込が CORS で失敗します）。
かならずローカル HTTP サーバー経由で開いてください。

```bash
python3 -m http.server 8123   # リポジトリ直下で実行
# → ブラウザで http://localhost:8123/ を開く（Chrome / Edge）
```

> Playwright のスモークテストは上記と同じローカル HTTP サーバーを自動起動します。  
> 初回実行前に `npx playwright install --with-deps chromium` が必要です（CI では自動実行）。

## ソース構成（Phase 1: モジュール分割後）

| ファイル | 役割 |
|---|---|
| `index.html` | HTML骨格のみ（インラインJS・インラインCSSなし） |
| `style.css` | スタイル |
| `js/state.js` | 共有可変状態（単一 `state` オブジェクト）＋ `FSA_SUPPORTED` |
| `js/dateutil.js` | 日付パース／整形（`pd`/`fmt`/`addDays`/`parseDate` ほか） |
| `js/domain.js` | 判定・予定日計算・可視行・月別集計 |
| `js/storage.js` | FSA・IndexedDB・保存／読込／バックアップ／他者更新検知 |
| `js/importers.js` | CSV取込・Excel移行 |
| `js/exporters.js` | Excel書き出し・SMS配信リスト書き出し |
| `js/render.js` | DOM描画（render/renderDetail/strip/stats ほか） |
| `js/main.js` | エントリ。一覧操作・画面遷移・`window` への関数公開・初期化 |

> onclick 属性ハンドラは Phase 1 では維持し、`main.js` が必要関数を `window` に公開しています（addEventListener 化は Phase 4 予定）。

## ブランチ戦略

- `main`: 本番（GitHub Pages）。直接コミット禁止
- `refactor/phase-N`: リファクタリング作業ブランチ
- 各フェーズは 1 ブランチ・1 PR。マージ前に CI（lint + vitest + Playwright）緑を確認

## アーキテクチャメモ

- ランタイムはノービルドを維持（ES Modules + 複数ファイル分割を Phase 1 で予定）
- Node.js は `devDependencies` のみ（テスト・lint 専用）
- 実データ（JSON 台帳・Excel 台帳）は **絶対にリポジトリに入れない**（`.gitignore` で除外済み）
