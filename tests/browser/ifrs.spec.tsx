import React from 'react';
import { test,expect } from '@playwright/experimental-ct-react';
import ValuationPage from '../../src/app/inventory/valuation/page';
import PoliciesPage from '../../src/app/accounting/policies/page';

test('valuation policy retry preserves its original request after a lost response',async ({mount,page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/test/ifrs/valuation',r => r.fulfill({json:{formula:null,allowance_account_id:null,items:[],events:[]}}));
  await page.route('**/test/ifrs/metadata',r => r.fulfill({json:{success:true,data:{accounts:[{id:'allowance',name:'NRV allowance',code:'1301',type:'CURRENT_ASSET',flow_section:'operating'}],suppliers:[],closes:[],checklist:{}}}}));
  const payloads:unknown[]=[];
  await page.route('**/test/ifrs/write',async route => {payloads.push(route.request().postDataJSON());await route.fulfill({json:payloads.length===1 ? {success:false,error:'Response lost',uncertain:true}:{success:true,data:{}}});});
  const component=await mount(<ValuationPage />);
  await component.getByRole('combobox',{name:'Allowance account',exact:true}).selectOption('allowance');
  await component.getByLabel('Accountant-approved policy reference').fill('Signed accountant costing policy REF-01');
  await component.getByRole('button',{name:'Adopt moving weighted average'}).click();
  await expect(component.getByRole('combobox',{name:'Allowance account',exact:true})).toBeDisabled();
  await component.getByRole('button',{name:'Retry saved request'}).click();
  await expect(component.getByRole('status')).toContainText('Recorded.');
  expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('close submits accountant evidence and prevents approval of an unreconciled schedule',async ({mount,page}) => {
  await page.route('**/test/ifrs/metadata',r => r.fulfill({json:{success:true,data:{accounts:[],suppliers:[],closes:[],checklist:{'PRES-01':'Statement presentation and notes'}}}}));
  let submitted:Record<string,unknown>|null=null;
  await page.route('**/test/ifrs/close',async route => {
    submitted=route.request().postDataJSON();
    await route.fulfill({json:{success:true,data:{id:'close-1',issues:[{check:'TAX-01',message:'Tax schedule does not reconcile'}],ready_for_owner_approval:false,statement_basis:'IAS 1 / pre-IFRS18 IAS 7',comprehensive_income:{net_profit:['0.00'],other_comprehensive_income:['0.00'],total_comprehensive_income:['0.00']},changes_in_equity:[]}}});
  });
  const component=await mount(<PoliciesPage />);
  await component.getByLabel('Period start').fill('2026-10-01');
  await component.getByLabel('Period end').fill('2026-10-31');
  await component.getByLabel('Annual package with corresponding prior-year comparison').uncheck();
  await component.getByRole('combobox',{name:/Comparison/}).selectOption('prior');
  await component.getByLabel('Reviewing accountant').fill('Reviewing Accountant');
  await component.getByLabel('Accountant review reference').fill('Signed accountant review reference DOC-01');
  await component.locator('summary').filter({hasText:'PRES-01'}).click();
  await component.getByLabel('Policy, disclosure and assessment (explain exclusions)').fill('Applicable presentation and notes reviewed for this period.');
  await component.getByLabel('Supporting review reference').fill('Signed presentation review reference DOC-02');
  await component.getByRole('button',{name:'Save and check close'}).click();
  await expect(component.getByText('TAX-01: Tax schedule does not reconcile')).toBeVisible();
  await component.getByLabel('Independent Owner/Admin approval reference').fill('Independent reviewer evidence DOC-03');
  await expect(component.getByRole('button',{name:'Record independent approval'})).toBeDisabled();
  expect(submitted).toMatchObject({annual:false,compare:'prior',accountant_name:'Reviewing Accountant'});
  await expect(component.getByText(/does not automatically certify IFRS compliance/)).toBeVisible();
});
