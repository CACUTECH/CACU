import { test, expect } from '@playwright/experimental-ct-react';
import Page1 from '../../src/app/settings/locale/page';
import Page3 from '../../src/app/settings/customers/page';
import Page4 from '../../src/app/analytics/kpi/page';
import Page12 from '../../src/app/settings/profile/page';

test('settings/locale has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page1 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Language & Currency' })).toBeVisible();
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

test('settings/profile has an honest unavailable state on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<Page12 />);
  await expect(component.getByRole('heading', { level: 1, name: 'Personal Profile' })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Not available yet', exact: true })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await expect(component.locator('input, button, form, table, canvas, svg, [role="switch"], [role="combobox"]')).toHaveCount(0);
  await expect(component).not.toContainText('₦');
});
