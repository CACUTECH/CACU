import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import CashFlowPage from '../../src/app/accounting/cash-flow/page';
import fixture from './cash-flow-fixture.json';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';

test('shows reconciled ledger figures, transaction drill-down and exact CSV', async ({ mount, page }) => {
  const component = await mount(<CashFlowPage />);
  await component.getByLabel('Start date').fill(fixture.start_date);
  await component.getByLabel('End date').fill(fixture.end_date);
  await page.evaluate(() => { (window as Window & { __holdCashFlow?: boolean }).__holdCashFlow = true; });
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByRole('button', { name: 'Loading…' })).toBeVisible();
  await page.evaluate(() => { (window as Window & { __holdCashFlow?: boolean }).__holdCashFlow = false; });
  await expect(component.getByText('Reconciled', { exact: true })).toBeVisible();
  await expect(component.getByText('-₦75,000.00', { exact: true })).toBeVisible();
  await expect(component.getByText('₦925,000.00', { exact: true }).first()).toBeVisible();
  await component.locator('summary').filter({ hasText: 'Net profit' }).click();
  await expect(component.locator('details').filter({ hasText: 'Net profit' }).locator('li').filter({ hasText: '₦60,000.00' }).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await component.getByRole('button', { name: 'CSV', exact: true }).click();
  const file = await download; const csv = await fs.readFile((await file.path())!, 'utf8');
  expect(csv).toContain('"Total operating","-75000.00"');
  expect(csv).toContain('"Closing cash","925000.00"');
  expect(csv).toContain('"Reconciliation difference","0.00"');
});

test('comparison uses the selected scope and error clears financial figures', async ({ mount }) => {
  const component = await mount(<CashFlowPage />);
  await component.getByLabel('Compare previous equal period').check();
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText(/Comparison:/)).toBeVisible();
  await expect(component.getByRole('columnheader', { name: 'Prior (NGN)' }).first()).toBeVisible();
  await component.getByLabel('Start date').fill('2020-01-01');
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByRole('alert')).toHaveText('Accounting unavailable');
  await expect(component.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(0);
  await expect(component.getByText('₦925,000.00', { exact: true })).toHaveCount(0);
});


test('Excel and PDF exports retain displayed backend amounts', async ({ mount, page }) => {
  const component = await mount(<CashFlowPage />);
  await component.getByLabel('Start date').fill(fixture.start_date);
  await component.getByLabel('End date').fill(fixture.end_date);
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText('Reconciled', { exact: true })).toBeVisible();
  const excelPromise = page.waitForEvent('download');
  await component.getByRole('button', { name: 'Excel', exact: true }).click();
  const excel = await excelPromise; const bytes = await fs.readFile((await excel.path())!);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Cash Flow'], { header: 1 });
  expect(rows).toContainEqual(['Closing cash', '925000.00']);
  expect(rows).toContainEqual(['Total operating', '-75000.00']);
  const pdfPromise = page.waitForEvent('download');
  await component.getByRole('button', { name: 'PDF', exact: true }).click();
  const pdf = await pdfPromise; const content = await fs.readFile((await pdf.path())!, 'latin1');
  expect(content).toMatch(/^%PDF/); expect(content).toContain('925000.00'); expect(content).toContain('-75000.00');
});
