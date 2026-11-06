import { routeParts, serviceUrl, ServiceUrlError } from '@/lib/service-url';

// CodeQL js/request-forgery: requests from the Next.js server go only to the configured service, whatever the input.
const api = new URL('https://api.cacu.example/base/');
const business = '4b6f3a2e-1c1d-4e8f-9a0b-2c3d4e5f6a7b';

test('builds the path under the configured host from checked segments', () => {
  expect(serviceUrl(api, ['api', 'v1', 'businesses', business, 'sales']).toString())
    .toBe(`https://api.cacu.example/api/v1/businesses/${business}/sales`);
  expect(serviceUrl(api, ['files', business], { preview: 'true' }, true).toString())
    .toBe(`https://api.cacu.example/base/files/${business}?preview=true`);
});

test.each([
  ['..'], ['.'], ['a/b'], ['//evil.example'], ['evil.example'], ['@evil.example'], ['%2F'], [''], ['x'.repeat(101)], ['https:'],
])('refuses the segment %p', segment => {
  expect(() => serviceUrl(api, ['api', segment])).toThrow(ServiceUrlError);
});

test('splits routes, decodes encoded ids, and refuses encoded traversal', () => {
  const { segments, query } = routeParts(`sales/${encodeURIComponent(business)}/refunds?day=2026-11-07`);
  expect(segments).toEqual(['sales', business, 'refunds']);
  expect(query.get('day')).toBe('2026-11-07');
  for (const bad of ['sales/%2E%2E/admin', 'sales/..', 'sales/a%2Fb', '//evil.example/x', 'https://evil.example', 'sales/%E0%A4%A']) {
    expect(() => routeParts(bad)).toThrow(ServiceUrlError);
  }
});

test('query values cannot change the host or path', () => {
  const { segments, query } = routeParts('reports/general-ledger?next=https://evil.example/&x=../../admin');
  const url = serviceUrl(api, ['api', ...segments], query);
  expect(url.host).toBe('api.cacu.example');
  expect(url.pathname).toBe('/api/reports/general-ledger');
  expect(url.searchParams.get('next')).toBe('https://evil.example/');
});
