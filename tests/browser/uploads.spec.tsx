import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { FileAttachments } from '../../src/components/file-attachments';

const ident='22222222-2222-4222-8222-222222222222';
test('attachment control rejects SVG and uses private file routes for upload, download and preview',async({mount,page})=>{
  let files:{id:string;original_name:string;mime:string;size_bytes:number}[]=[];
  await page.route('**/api/files**',async route=>{
    if(route.request().method()==='POST') {
      expect(route.request().headers()['content-type']).toBe('image/png');
      expect(route.request().headers()['x-upload-filename']).toBe('receipt.png');
      files=[{id:ident,original_name:'receipt.png',mime:'image/png',size_bytes:70}];
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(files[0])});
    } else await route.fulfill({contentType:'application/json',body:JSON.stringify(files)});
  });
  const component=await mount(<FileAttachments purpose="invoice_attachment" resourceId={ident} />);
  await expect(component.getByText('No approved attachments yet.')).toBeVisible();
  await component.getByLabel('Add attachment').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await expect(component.getByRole('alert')).toHaveText('Choose a PNG or JPG image.');
  await expect(component.getByRole('button',{name:'Upload',exact:true})).toBeDisabled();
  await component.getByLabel('Add attachment').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD2UAAAAASUVORK5CYII=','base64')});
  await component.getByRole('button',{name:'Upload',exact:true}).click();
  await expect(component.getByRole('link',{name:'Download',exact:true})).toHaveAttribute('href',`/api/files/${ident}`);
  await expect(component.getByRole('link',{name:'Preview',exact:true})).toHaveAttribute('href',`/api/files/${ident}?preview=true`);
});
