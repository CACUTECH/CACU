import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import ExpensesPage from '../../src/app/accounting/expenses/page';
import { StockApprovals } from '../../src/components/stock-approvals';

test('owner records an expense, retries an unconfirmed save with the same key, and reverses it on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const component = await mount(<ExpensesPage />);
  await expect(component.getByText('No expenses recorded yet.')).toBeVisible();
  await component.getByLabel('Expense account').selectOption('e2');
  await component.getByLabel('Amount (NGN)').fill('15000');
  await component.getByLabel('Description').fill('Diesel for the generator');
  await component.getByLabel('Paid with').selectOption('Transfer');
  await expect(component.getByRole('button', { name: 'Record expense' })).toBeVisible();
  await component.getByLabel('Bank account').selectOption('b1');
  await component.getByRole('button', { name: 'Record expense' }).click();
  await expect(component.getByRole('alert')).toContainText('503');
  await expect(component.getByLabel('Amount (NGN)')).toBeDisabled();  // the unconfirmed request cannot be edited
  await component.getByRole('button', { name: 'Retry' }).click();
  await expect(component.getByRole('status')).toHaveText('Expense recorded.');
  const keys = await page.evaluate(() => (window as unknown as { expenseKeys: string[] }).expenseKeys);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const row = component.getByRole('row', { name: /Diesel for the generator/ });
  await expect(row).toContainText('15,000.00');
  await row.getByRole('button', { name: 'Reverse' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Post reversal' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Entered twice');
  await dialog.getByRole('button', { name: 'Post reversal' }).click();
  await expect(row).toContainText('Reversed');
  await expect(row.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('owner approves another person\'s stock change, needs a note to reject, cannot approve their own, and sets the rule', async ({ mount, page }) => {
  const component = await mount(<StockApprovals revision={0} onDecided={() => undefined} />);
  await expect(component.getByText(/Owners and Admins post stock changes directly/)).toBeVisible();
  await expect(component.getByText(/Nobody can approve their own request/)).toBeVisible();
  const rice = component.getByRole('listitem').filter({ hasText: 'Rice' });
  const beans = component.getByRole('listitem').filter({ hasText: 'Beans' });
  await expect(rice).toContainText('-2');
  await expect(rice.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await expect(beans.getByRole('button', { name: 'Approve and post' })).toHaveCount(0);
  await expect(beans).toContainText('Another Owner or Admin must approve this.');
  await expect(beans.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await rice.getByLabel('Note for Rice').fill('Checked the store');
  await rice.getByRole('button', { name: 'Approve and post' }).click();
  await expect(component.getByRole('listitem')).toHaveCount(1);
  await beans.getByRole('button', { name: 'Withdraw' }).click();
  await expect(component.getByText('Nothing is waiting.')).toBeVisible();
  const decisions = await page.evaluate(() => (window as unknown as { decisions: { id: string; approve: boolean; note: string }[] }).decisions);
  expect(decisions).toEqual([{ id: 'r1', approve: true, note: 'Checked the store' }, { id: 'r2', approve: false, note: '' }]);

  await component.getByLabel(/need approval above/).fill('50,000');
  await component.getByRole('button', { name: 'Save rule' }).click();
  await expect(component.getByRole('alert')).toContainText('Enter the limit as an amount');
  await component.getByLabel(/need approval above/).fill('50000');
  await component.getByRole('button', { name: 'Save rule' }).click();
  await expect(component.getByRole('status')).toHaveText('Approval rule saved.');
  await expect(component.getByText(/worth more than NGN 50,000.00/)).toBeVisible();
});
