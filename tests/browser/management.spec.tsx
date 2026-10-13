import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { CatalogWorkspace } from '../../src/components/catalog-workspace';
import { UserManagement } from '../../src/components/user-management';

test('mobile product creation retries the original opening stock request', async ({ mount, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/test/catalog?*', route => route.fulfill({ json: { data: [], total: 0 } }));
    const attempts: unknown[] = [];
    await page.route('**/test/catalog-mutation', async route => {
        const body = await route.request().postDataJSON();
        attempts.push(body);

        if (attempts.length === 1) {
            // A non-JSON gateway response deterministically exercises the uncertain-result path.
            await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Upstream response unavailable' });
            return;
        }

        await route.fulfill({ json: { success: true, data: {} } });
    });
    await mount(<CatalogWorkspace />);
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Real product');
    await page.getByLabel('Selling price (NGN)').fill('150.50');
    await page.getByLabel('Opening quantity').fill('5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Response unavailable', { timeout: 10000 });
    await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await page.getByRole('button', { name: 'Retry original request' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toMatchObject({ operation: 'item.save', details: { opening_quantity: 5, unit_price: '150.50' } });
});

test('services have rates and billing units without product stock inputs', async ({ mount, page }) => {
    await page.route('**/test/catalog?*', route => route.fulfill({ json: { data: [], total: 0 } }));
    await mount(<CatalogWorkspace />);
    await page.getByRole('tab', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    await expect(page.getByLabel('Rate (NGN)')).toBeVisible();
    await expect(page.getByLabel('Billing unit')).toBeVisible();
    await expect(page.getByLabel('Opening quantity')).toHaveCount(0);
    await expect(page.getByLabel('Track stock')).toHaveCount(0);
});

test('user management displays real directory rows and deactivates with a version', async ({ mount, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/test/workspace/*', route => route.fulfill({
        json: {
            total: 1,
            locations: [],
            data: [{
                id: 'member',
                name: 'Existing member',
                email: 'member@example.com',
                role: 'editor',
                status: 'active',
                version: 3,
            }],
        },
    }));
    const requests: unknown[] = [];
    await page.route('**/test/workspace-mutation', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true, data: {} } }); });
    await mount(<UserManagement />);
    await expect(page.getByText('member@example.com')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Teams', exact: true })).toBeVisible();
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    expect(requests[0]).toMatchObject({ operation: 'member.status', item_id: 'member', expected_version: 3, details: { is_active: false } });
});


test('editing a legacy item does not replace an unknown cost with zero',async({mount,page})=>{
  await page.route('**/test/catalog?*',route=>route.fulfill({json:{total:1,data:[{id:'old',name:'Original',item_type:'PRODUCT',sku:'old-code',category_id:null,category:'Uncategorized',unit_price:'1.00',cost_price:null,opening_quantity:0,track_stock:true}]}}));
  const requests:Record<string,unknown>[]=[];await page.route('**/test/catalog-mutation',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{success:true,data:{id:'old'}}})});
  await mount(<CatalogWorkspace/>);await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Renamed');await page.getByRole('button',{name:'Save',exact:true}).click();
  expect(requests).toHaveLength(1);expect(requests[0].details).not.toHaveProperty('cost_price');expect(requests[0].details).not.toHaveProperty('opening_quantity');
});


test('recorded inventory history locks structure controls while normal edits remain available',async({mount,page})=>{
 await page.route('**/test/catalog?*',route=>route.fulfill({json:{total:1,data:[{id:'old',name:'Previously stocked',item_type:'PRODUCT',sku:'old-code',category_id:null,category:'Uncategorized',unit_price:'100.00',cost_price:'20.00',version:3,stock_quantity:0,reorder_level:0,is_active:true,track_stock:true,structure_locked:true,unit_of_measure:'piece',billing_unit:'service',tax_code:'none',duration:0,created_at:'2026-01-01',updated_at:'2026-01-01'}]}}));
 await mount(<CatalogWorkspace/>);await page.getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.getByLabel('Item type',{exact:true})).toBeDisabled();await expect(page.getByLabel('Track stock',{exact:true})).toBeDisabled();
 await page.getByText('Additional details',{exact:true}).click();await expect(page.getByRole('combobox',{name:'Stock unit',exact:true})).toBeDisabled();
 await expect(page.getByLabel('Name',{exact:true})).toBeEnabled();await expect(page.getByLabel('Selling price (NGN)',{exact:true})).toBeEnabled();
 await expect(page.getByText('Type, stock unit and tracking are locked once stock, adjustments or document references exist.')).toBeVisible();
});

for (const action of [
    { operation: 'member.status', label: 'Deactivate', status: 'active' },
    { operation: 'invitation.resend', label: 'Renew invitation', status: 'invited' },
    { operation: 'invitation.cancel', label: 'Cancel', status: 'invited' },
]) {
    test(`${action.label} retries an uncertain response with the original key and version`, async ({ mount, page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.route('**/test/workspace/*', route => route.fulfill({ json: { total: 1, locations: [], data: [{ id: 'member', name: 'Existing member', email: 'member@example.com', role: 'editor', status: action.status, version: 3, all_locations: true, created_at: '2026-10-12T00:00:00Z' }] } }));
        const attempts: Record<string, unknown>[] = [];
        await page.route('**/test/workspace-mutation', async route => {
            attempts.push(route.request().postDataJSON());
            if (attempts.length === 1) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Upstream response unavailable' });
            return route.fulfill({ json: { success: true, data: {} } });
        });
        page.on('dialog', dialog => dialog.accept());
        await mount(<UserManagement />);
        await page.getByRole('button', { name: action.label, exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Response unavailable');
        await expect(page.getByRole('button', { name: action.label, exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Invite user', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Retry original request', exact: true }).click();
        await expect(page.getByRole('status')).toContainText('Changes saved');
        await expect(page.getByRole('button', { name: 'Retry original request', exact: true })).not.toBeVisible();
        await expect(page.getByRole('button', { name: action.label, exact: true })).toBeEnabled();
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(attempts[0]);
        expect(attempts[0]).toMatchObject({ operation: action.operation, item_id: 'member', expected_version: 3, request_key: expect.any(String) });
    });
}

test('confirmed user update rejection releases the original request for a corrected attempt', async ({ mount, page }) => {
    await page.route('**/test/workspace/*', route => route.fulfill({ json: { total: 1, locations: [], data: [{ id: 'member', name: 'Existing member', email: 'member@example.com', role: 'editor', status: 'active', version: 3, all_locations: true, created_at: '2026-10-12T00:00:00Z' }] } }));
    const attempts: Record<string, unknown>[] = [];
    await page.route('**/test/workspace-mutation', route => {
        attempts.push(route.request().postDataJSON());
        return route.fulfill({ json: attempts.length === 1 ? { success: false, uncertain: false, error: 'Review the current member before changing access' } : { success: true, data: {} } });
    });
    page.on('dialog', dialog => dialog.accept());
    await mount(<UserManagement />);
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Review the current member');
    await expect(page.getByRole('button', { name: 'Deactivate', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Retry original request', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    expect(attempts).toHaveLength(2);
    expect(attempts[1].request_key).not.toEqual(attempts[0].request_key);
});

test('user edit form retains its unconfirmed payload after closing and reopening', async ({ mount, page }) => {
    await page.route('**/test/workspace/*', route => route.fulfill({ json: { total: 1, locations: [], data: [{ id: 'member', name: 'Existing member', email: 'member@example.com', role: 'editor', status: 'active', version: 3, all_locations: true, created_at: '2026-10-12T00:00:00Z' }] } }));
    const attempts: Record<string, unknown>[] = [];
    await page.route('**/test/workspace-mutation', route => {
        attempts.push(route.request().postDataJSON());
        if (attempts.length === 1) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Upstream response unavailable' });
        return route.fulfill({ json: { success: true, data: {} } });
    });
    await mount(<UserManagement />);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Reviewed member name');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Response unavailable');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry original request', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('status')).toContainText('Changes saved');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toMatchObject({ operation: 'member.save', expected_version: 3, details: { name: 'Reviewed member name' } });
});
