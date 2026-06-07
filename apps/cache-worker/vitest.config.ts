import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          TURBO_TOKEN: "test-token,rotated-token",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
