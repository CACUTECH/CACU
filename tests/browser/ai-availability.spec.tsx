import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { AIAssistant } from '../../src/components/ai-assistant';
import PoliciesPage from '../../src/app/accounting/policies/page';

test('mobile assistant shows readiness without sending page contents or accepting prompts', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const outbound: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') outbound.push(request.url()); });
  await mount(<main><p>Confidential customer and employee figures</p><AIAssistant /></main>);
  await page.getByRole('button', { name: 'AI assistant availability' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/AI generation is not available yet/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(outbound).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('policy screen has no active sample policies or fake persistence actions', async ({ mount }) => {
  const component = await mount(<PoliciesPage />);
  await expect(component.getByRole('heading', { name: 'Accounting Policies & Notes' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('textbox')).toHaveCount(0);
  await expect(component.getByRole('button', { name: /save|generate|history/i })).toHaveCount(0);
});
