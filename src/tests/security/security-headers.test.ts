import nextConfig from '../../../next.config';
import { contentSecurityPolicy, securityHeaders, supabaseOrigins } from '@/lib/security-headers';

// TEST-406: content security policy and Doc 16 headers present; no sample-image hosts allowed.
describe('security headers', () => {
  const supabase = 'https://abcd1234.supabase.co';

  test('every route gets the content security policy and permissions policy', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabase;
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    const keys = rules[0].headers.map(header => header.key);
    expect(keys).toEqual(['Content-Security-Policy', 'Permissions-Policy']);
  });

  test('policy allows only this app and its own Supabase project', () => {
    const policy = contentSecurityPolicy(supabase);
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(policy).toContain(directive);
    }
    expect(policy).toContain(`connect-src 'self' ${supabase} wss://abcd1234.supabase.co`);
    expect(policy).toContain(`img-src 'self' data: blob: ${supabase}`);
    expect(policy).not.toMatch(/unsafe-eval|placehold\.co|picsum\.photos|\*\s|https:\s|http:\s/);
  });

  test('a missing or malformed Supabase URL falls back to Supabase hosts only', () => {
    expect(supabaseOrigins(undefined)).toEqual({ https: 'https://*.supabase.co', wss: 'wss://*.supabase.co' });
    expect(supabaseOrigins('javascript:alert(1)')).toEqual({ https: 'https://*.supabase.co', wss: 'wss://*.supabase.co' });
  });

  test('camera, microphone and location are not available to the page', () => {
    const permissions = securityHeaders(supabase).find(header => header.key === 'Permissions-Policy')!.value;
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('geolocation=()');
  });

  test('no prototype image hosts are allowed', () => {
    expect(JSON.stringify(nextConfig.images ?? {})).not.toMatch(/placehold\.co|picsum\.photos/);
  });
});
