# ゴルフコンペ予約チェック管理

ゴルフ場のコンペ予約を一元管理するシングルページアプリ。  
受付から組合せ入力までの追客コンタクト（①受付翌日・②60日前・③35日前・④18日前）を一覧・状態管理します。

## 特徴

- **ノービルド、単一ファイル**: `index.html` 1本で完結。Node.js 実行環境不要
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
npm run lint         # ESLint（tests/ 配下のみ）
npm test             # Vitest ユニットテスト
npm run test:e2e     # Playwright スモークテスト（Chrome / Chromium）
npm run fmt          # Prettier（tests/ 配下のみ）
```

> Playwright のスモークテストはローカル HTTP サーバー（`python3 -m http.server 8123`）を自動起動します。  
> 初回実行前に `npx playwright install --with-deps chromium` が必要です（CI では自動実行）。

## ブランチ戦略

- `main`: 本番（GitHub Pages）。直接コミット禁止
- `refactor/phase-N`: リファクタリング作業ブランチ
- 各フェーズは 1 ブランチ・1 PR。マージ前に CI（lint + vitest + Playwright）緑を確認

## アーキテクチャメモ

- ランタイムはノービルドを維持（ES Modules + 複数ファイル分割を Phase 1 で予定）
- Node.js は `devDependencies` のみ（テスト・lint 専用）
- 実データ（JSON 台帳・Excel 台帳）は **絶対にリポジトリに入れない**（`.gitignore` で除外済み）
