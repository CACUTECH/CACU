/**
 * Response headers for every route (Doc 16 SEC-022/SEC-031, Doc 19 TEST-406).
 * The browser only talks to this app and to the Supabase project (Auth and Realtime), so those are the
 * only allowed origins. Scripts run only with the per-request nonce the middleware sets (SEC-022); Next.js adds
 * it to its own scripts, and 'strict-dynamic' lets those load the app's chunks. Styles stay inline-capable,
 * because the UI components set inline styles.
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

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function contentSecurityPolicy(supabaseUrl: string | undefined, nonce: string, development = false): string {
  const supabase = supabaseOrigins(supabaseUrl);
  // React's development tooling evaluates code; production never allows eval.
  const scripts = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`;
  return [
    "default-src 'self'",
    scripts,
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

/** Static headers for every route. The content security policy carries a per-request nonce, so the middleware sets it. */
export function securityHeaders() {
  return [
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
  ];
}
