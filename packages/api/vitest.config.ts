import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript sources — never the compiled copies in dist/.
    include: ['src/**/*.{spec,test}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    environment: 'node',
  },
});
