import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
    },
    include: ["{apps,packages,scripts}/**/*.{test,spec}.ts"],
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
