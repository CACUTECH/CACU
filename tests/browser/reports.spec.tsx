import React from 'react';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { test, expect } from '@playwright/experimental-ct-react';
import ReportsPage from '../../src/app/reports/page';

test('three report tabs stay accessible, statements run by period with labels and an optional comparison, on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<ReportsPage />);
  await expect(component.getByRole('tab')).toHaveCount(3);
  await component.getByLabel('From').fill('2026-10-01');
  await component.getByLabel('To').fill('2026-10-31');
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText(/Management statements, not reviewed · Accrual basis · NGN/)).toBeVisible();
  await expect(component.getByRole('row', { name: /Gross profit/ })).toContainText('15,000.00');
  await expect(component.getByRole('row', { name: /^Net profit/ })).toContainText('0.00');
  await expect(component.getByRole('columnheader')).toHaveText(['', '2026-10-01 to 2026-10-31']);

  await component.getByRole('tab', { name: 'Balance Sheet', exact: true }).click();
  await component.getByLabel('From').fill('2026-10-01');
  await component.getByLabel('To').fill('2026-10-31');
  await component.getByLabel('Compare with').selectOption('prior');
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByRole('columnheader')).toHaveText(['', 'As of 2026-10-31', 'As of 2026-09-30']);
  await expect(component.getByRole('alert')).toContainText('Assets do not equal liabilities and equity at the end of the comparison period');
  await expect(component.getByRole('row', { name: /^Total assets/ })).toContainText('5,000.00');

  await component.getByRole('tab', { name: 'Cash Flow Statement', exact: true }).click();
  await expect(component.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText('Reconciled', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { statementCalls: unknown[][] }).statementCalls);
  expect(calls).toEqual([['2026-10-01', '2026-10-31', ''], ['2026-10-01', '2026-10-31', 'prior']]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('statements export to Excel with labels, exceptions and the displayed amounts', async ({ mount, page }) => {
  const component = await mount(<ReportsPage />);
  await component.getByLabel('From').fill('2026-10-01');
  await component.getByLabel('To').fill('2026-10-31');
  await component.getByLabel('Compare with').selectOption('last_year');
  await component.getByRole('button', { name: 'Run report' }).click();
  const download = page.waitForEvent('download');
  await component.getByRole('button', { name: 'Excel', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('profit-or-loss-2026-10-01-2026-10-31.xlsx');
  const sheet = XLSX.read(await fs.readFile((await file.path())!)).Sheets['Profit or loss'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  expect(rows.slice(0, 4).flat()).toEqual(['Business', 'Statement of Profit or Loss', 'Management statements, not reviewed · Accrual basis · NGN', 'Generated 2026-11-01 10:00:00+01:00']);
  expect(rows).toContainEqual(['Gross profit', 15000, 10000]);
  expect(rows).toContainEqual(['Exception: Assets do not equal liabilities and equity at the end of the comparison period']);
});
