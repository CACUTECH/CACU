import { defineConfig } from '@playwright/experimental-ct-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.tsx', fullyParallel: false,
  use: { ctPort: 3101, viewport: { width: 1280, height: 900 }, ctViteConfig: async () => ({
    resolve: { alias: { '@/components/business-provider': path.resolve(__dirname, 'tests/browser/upload-business.ts'), '@': path.resolve(__dirname, 'src') } },
    plugins: [(await import(pathToFileURL(require.resolve('@vitejs/plugin-react', { paths: [require.resolve('@playwright/experimental-ct-react')] })).href)).default(), { name: 'cash-flow-action-test-double', enforce: 'pre', resolveId(source, importer) {
      if (source === '@/components/business-provider' && importer?.replaceAll('\\', '/').endsWith('/components/file-attachments.tsx')) return path.resolve(__dirname, 'tests/browser/upload-business.ts');
      if (source === './actions' && importer?.replaceAll('\\', '/').endsWith('/reports/page.tsx')) return path.resolve(__dirname, 'tests/browser/reports-action.ts');
      if (source === './actions' && importer?.replaceAll('\\', '/').endsWith('/accounting/cash-flow/cash-flow-statement.tsx')) return path.resolve(__dirname, 'tests/browser/cash-flow-action.ts');
    } }],
  }) },
});
