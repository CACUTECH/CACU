import { HELD_BACK, visibleNav } from '@/lib/preview';

const items = [{ href: '/' }, { href: '/hr' }, { href: '/credit' }, { href: '/accounting' }, { href: '/storefront' }];

test('held-back modules show only for the preview business', () => {
  expect(visibleNav(items, false).map(i => i.href)).toEqual(['/', '/accounting']);
  expect(visibleNav(items, true).map(i => i.href)).toEqual(['/', '/hr', '/credit', '/accounting', '/storefront']);
  expect(HELD_BACK).toContain('/hr');
});

test('held-back entries inside a menu are hidden too', () => {
  const menu = [{ href: '/accounting', children: [{ href: '/accounting/fixed-assets' }, { href: '/accounting/income-tax' }] }];
  expect(visibleNav(menu, false)[0].children?.map(i => i.href)).toEqual(['/accounting/fixed-assets']);
  expect(visibleNav(menu, true)[0].children).toHaveLength(2);
});
