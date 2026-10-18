import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Gerçek servislere (Postgres, WhatsApp, Claude) giden testler. `npm run test:live`.
export default defineConfig({
  test: {
    include: ['tests/**/*.live.test.ts'],
    testTimeout: 60_000,
  },
});
