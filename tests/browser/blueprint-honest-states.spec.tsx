import { test, expect } from '@playwright/experimental-ct-react';
import Page0 from '../../src/app/settings/taxes/page';
import Page1 from '../../src/app/settings/locale/page';
import Page2 from '../../src/app/settings/notifications/page';
import Page3 from '../../src/app/settings/customers/page';
import Page4 from '../../src/app/analytics/kpi/page';
import Page5 from '../../src/app/analytics/planning/page';
import Page6 from '../../src/app/analytics/budget-vs-actual/page';
import Page7 from '../../src/app/analytics/aging-reports/page';
import Page8 from '../../src/app/analytics/reconciliation/page';
import Page9 from '../../src/app/appointments/page';
import Page10 from '../../src/app/jobs/page';
import Page12 from '../../src/app/settings/profile/page';

test('settings/taxes has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page0 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Tax Settings' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('settings/locale has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page1 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Language & Currency' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('settings/notifications has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page2 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Notification Preferences' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('settings/customers has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page3 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Customer Loyalty' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('analytics/kpi has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page4 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Key Performance Indicators' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('analytics/planning has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page5 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Planning & Budgeting' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('analytics/budget-vs-actual has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page6 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Budget vs. Actual' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('analytics/aging-reports has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page7 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Receivables & Payables Aging' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('analytics/reconciliation has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page8 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Bank Reconciliation' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('appointments has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page9 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Appointments' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});

test('jobs has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page10 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Work Orders & Jobs' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});


test('settings/profile has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page12 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Personal Profile' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});
