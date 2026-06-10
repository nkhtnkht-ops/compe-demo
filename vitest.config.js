import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["tests/**/*.test.js", "tests/**/*.spec.js"],
    exclude: ["tests/e2e/**"],
  },
});
