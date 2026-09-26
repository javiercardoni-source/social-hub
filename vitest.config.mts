import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Cada test levanta un Postgres en memoria (PGlite): la primera migración tarda.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
