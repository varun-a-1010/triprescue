import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { NODE_ENV: "test", TRIPRESCUE_PROVIDER: "fixture", SESSION_SECRET: "test-secret-test-secret-test-secret-0000" },
  },
});
