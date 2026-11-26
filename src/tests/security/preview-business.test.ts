import { HELD_BACK, visibleNav } from '@/lib/preview';

const items = [{ href: '/' }, { href: '/hr' }, { href: '/credit' }, { href: '/accounting' }, { href: '/storefront' }];

test('held-back modules show only for the preview business', () => {
  expect(visibleNav(items, false).map(i => i.href)).toEqual(['/', '/accounting']);
  expect(visibleNav(items, true).map(i => i.href)).toEqual(['/', '/hr', '/credit', '/accounting', '/storefront']);
  expect(HELD_BACK).toContain('/hr');
});
