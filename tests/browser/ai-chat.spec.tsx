import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { AIAssistant } from '../../src/components/ai-assistant';
const businessId = '11111111-1111-4111-8111-111111111111';

test('mobile interrupted question reuses its key and needs explicit new-question intent', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(<AIAssistant businessId={businessId} />);
  await page.getByRole('button', { name: 'AI assistant availability' }).click();
  await page.getByLabel('Your question').fill('Interrupted question');
  await page.getByRole('button', { name: 'Ask OpenAI', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('interrupted');
  await expect(page.getByLabel('Your question')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same request' }).click();
  await expect(page.getByRole('alert')).toContainText('already submitted');
  const attempts = await page.evaluate(() => window.aiAttempts!);
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await page.getByRole('button', { name: 'New question', exact: true }).click();
  await page.getByLabel('Your question').fill('General question');
  await page.getByRole('button', { name: 'Ask OpenAI', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Review the recorded figures');
  const next = await page.evaluate(() => window.aiAttempts!);
  expect(next[2].requestKey).not.toBe(next[0].requestKey);
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(page.getByRole('log')).toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('business change clears chat and discards a late model response', async ({ mount, page }) => {
  const component = await mount(<AIAssistant businessId={businessId} />);
  await page.getByRole('button', { name: 'AI assistant availability' }).click();
  await page.getByLabel('Your question').fill('Wait for old business');
  await page.getByRole('button', { name: 'Ask OpenAI', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseAIAnswer)).toBe('function');
  await component.update(<AIAssistant businessId="22222222-2222-4222-8222-222222222222" />);
  await page.evaluate(() => window.releaseAIAnswer?.());
  await page.getByRole('button', { name: 'AI assistant availability' }).click();
  await expect(page.getByLabel('Your question')).toHaveValue('');
  await expect(page.getByRole('log')).toBeEmpty();
  await expect(page.getByText('Old business answer', { exact: true })).toHaveCount(0);
});
