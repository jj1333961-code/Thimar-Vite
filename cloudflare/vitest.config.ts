import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

/**
 * اختبارات workerd المحلية (Miniflare) لعامل staging وDurable Object.
 * لا تتصل بالشبكة: كل طلب خارجي يُعترض صراحة عبر fetchMock.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ENVIRONMENT: "staging",
          SESSION_SIGNING_SECRET: "test-session-secret-not-real",
          TURN_SHARED_SECRET: "test-turn-shared-secret-not-real",
          TURN_TTL_SECONDS: "900",
          ROOM_MAX_PARTICIPANTS: "10",
          ROOM_TOKEN_TTL_SECONDS: "300",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
