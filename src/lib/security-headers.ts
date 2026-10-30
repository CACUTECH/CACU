/**
 * Response headers for every route (Doc 16 SEC-022/SEC-031, Doc 19 TEST-406).
 * The browser only talks to this app and to the Supabase project (Auth and Realtime), so those are the
 * only allowed origins. Next.js still needs inline scripts and styles until nonces land (SEC-022, R1).
 */
export function supabaseOrigins(url: string | undefined): { https: string; wss: string } {
  try {
    const parsed = new URL(url || '');
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return { https: parsed.origin, wss: parsed.origin.replace(/^http/, 'ws') };
    }
  } catch {}
  return { https: 'https://*.supabase.co', wss: 'wss://*.supabase.co' };
}

export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const supabase = supabaseOrigins(supabaseUrl);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase.https}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.https} ${supabase.wss}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function securityHeaders(supabaseUrl: string | undefined) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(supabaseUrl) },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
  ];
}
