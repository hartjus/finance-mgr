import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/api/src/config.ts', 'apps/api/src/security.ts', 'apps/api/src/server.ts', 'apps/web/src/api.ts'],
      exclude: ['**/*.d.ts']
    }
  }
});
