/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const script = path.resolve(process.cwd(), 'scripts/check-openai.mjs');
test('operator check reports missing configuration without a provider request', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '' } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Set OPENAI_API_KEY and OPENAI_MODEL');
});
test('operator check is dry by default and never prints the configured key', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'test-secret-do-not-display', OPENAI_MODEL: 'test-model' } });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('No API request made');
  expect(result.stdout + result.stderr).not.toContain('test-secret-do-not-display');
});
