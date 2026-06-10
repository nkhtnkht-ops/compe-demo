import js from "@eslint/js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    // アプリ本体（ES Modules・ブラウザ実行）
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // ブラウザ環境
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        indexedDB: "readonly",
        console: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        FileReader: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        Blob: "readonly",
        URL: "readonly",
        Uint8Array: "readonly",
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        // 外部ライブラリ（通常 script で先読み）
        XLSX: "readonly",
        cptable: "readonly",
      },
    },
    rules: {
      // 空 catch（権限切れ等を握りつぶす既存パターン）と未使用 _ を許容
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // 全角スペース等を含む正規表現・文字列リテラルは意図的（氏名分割など）
      "no-irregular-whitespace": ["error", { skipStrings: true, skipRegExps: true }],
      // 既存コードの日付正規表現に含まれる冗長なエスケープは Phase 2 で整理（現状は不変のため許容）
      "no-useless-escape": "off",
      "no-console": "off",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals (for test files)
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // Vitest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
        // Browser globals used inside page.evaluate() callbacks
        window: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];
