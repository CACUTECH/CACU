import React from 'react';
import {test,expect} from '@playwright/experimental-ct-react';
import JoinPage from '../../src/app/join/page';
test('mobile invitation sign-in link retains the validated destination',async({mount,page})=>{
 await page.setViewportSize({width:390,height:844});await mount(<JoinPage/>);
 const link=page.getByRole('link',{name:'Sign in',exact:true});await expect(link).toBeVisible();
 const destination=new URL((await link.getAttribute('href'))!,'https://cacu.test');
 expect(destination.pathname).toBe('/login');expect(destination.searchParams.get('next')).toBe('/join?invitation=11111111-1111-4111-8111-111111111111');
 await expect(page.getByText('Signing in returns you to this invitation.',{exact:false})).toBeVisible();
});
