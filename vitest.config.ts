import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        inline: [
          "convex-test",
          "@convex-dev/workpool",
          "@convex-dev/batch-worker",
        ],
      },
    },
  },
});
