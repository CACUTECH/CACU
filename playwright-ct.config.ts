import { defineConfig } from '@playwright/experimental-ct-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.tsx', fullyParallel: false,
  use: { ctPort: 3101, viewport: { width: 1280, height: 900 }, ctViteConfig: async () => ({
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    plugins: [(await import(pathToFileURL(require.resolve('@vitejs/plugin-react', { paths: [require.resolve('@playwright/experimental-ct-react')] })).href)).default(), { name: 'cash-flow-action-test-double', enforce: 'pre', resolveId(source, importer) {
      if (source === './actions' && importer?.replaceAll('\\', '/').endsWith('/accounting/cash-flow/page.tsx')) return path.resolve(__dirname, 'tests/browser/cash-flow-action.ts');
    } }],
  }) },
});
