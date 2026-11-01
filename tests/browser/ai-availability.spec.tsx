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

test('policy screen reports missing accounting configuration without fake generation', async ({ mount, page }) => {
  await page.route('**/test/ifrs/metadata', route => route.fulfill({json:{success:false,error:'Accounting API is not configured'}}));
  const component = await mount(<PoliciesPage />);
  await expect(component.getByRole('heading', { name: 'Accounting policies & financial close' })).toBeVisible();
  await expect(component.getByRole('alert')).toHaveText('Accounting API is not configured');
  await expect(component.getByRole('button', { name: /generate|send/i })).toHaveCount(0);
});
