/** @jest-environment node */
import { NextRequest } from 'next/server';
import nextConfig from '../../../next.config';
import { contentSecurityPolicy, createNonce, securityHeaders, supabaseOrigins } from '@/lib/security-headers';

const refresh = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } }) => ({
    auth: { getUser: async () => { refresh(options.cookies); return { data: { user: null } }; } },
  }),
}));

// TEST-406 and SEC-022: content security policy with a per-request script nonce; Doc 16 headers; no sample-image hosts.
describe('security headers', () => {
  const supabase = 'https://abcd1234.supabase.co';

  test('every route gets the permissions policy; the content security policy comes from the middleware', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(rules[0].headers.map(header => header.key)).toEqual(['Permissions-Policy']);
  });

  test('scripts need the nonce, and the policy allows only this app and its own Supabase project', () => {
    const policy = contentSecurityPolicy(supabase, 'abc123');
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(policy).toContain(directive);
    }
    expect(policy).toContain(`connect-src 'self' ${supabase} wss://abcd1234.supabase.co`);
    expect(policy).toContain(`img-src 'self' data: blob: ${supabase}`);
    expect(policy.split('; ').find(d => d.startsWith('script-src'))).not.toContain('unsafe-inline');
    expect(policy).not.toMatch(/unsafe-eval|placehold\.co|picsum\.photos|\*\s|https:\s|http:\s/);
    expect(contentSecurityPolicy(supabase, 'abc123', true)).toContain("'strict-dynamic' 'unsafe-eval'");
  });

  test('nonces are unpredictable and differ per call', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{40,}={0,2}$/);
  });

  test('a missing or malformed Supabase URL falls back to Supabase hosts only', () => {
    expect(supabaseOrigins(undefined)).toEqual({ https: 'https://*.supabase.co', wss: 'wss://*.supabase.co' });
    expect(supabaseOrigins('javascript:alert(1)')).toEqual({ https: 'https://*.supabase.co', wss: 'wss://*.supabase.co' });
  });

  test('camera, microphone and location are not available to the page', () => {
    const permissions = securityHeaders().find(header => header.key === 'Permissions-Policy')!.value;
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('geolocation=()');
  });

  test('no prototype image hosts are allowed', () => {
    expect(JSON.stringify(nextConfig.images ?? {})).not.toMatch(/placehold\.co|picsum\.photos/);
  });
});

describe('middleware', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcd1234.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    refresh.mockReset();
  });

  test('each response carries a fresh nonce, and the same policy is forwarded so Next.js can tag its scripts', async () => {
    const { middleware } = await import('@/middleware');
    const first = await middleware(new NextRequest('https://cacu.example/dashboard'));
    const second = await middleware(new NextRequest('https://cacu.example/dashboard'));
    const policy = first.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(policy)![1];
    expect(policy).not.toBe(second.headers.get('content-security-policy'));
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  test('refreshed sign-in cookies still reach the page and the browser alongside the nonce', async () => {
    refresh.mockImplementation(cookies => cookies.setAll([{ name: 'sb-token', value: 'renewed', options: { path: '/' } }]));
    const { middleware } = await import('@/middleware');
    const response = await middleware(new NextRequest('https://cacu.example/dashboard', { headers: { cookie: 'sb-token=old' } }));
    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-token=renewed');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeTruthy();
    expect(response.cookies.get('sb-token')?.value).toBe('renewed');
  });
});
