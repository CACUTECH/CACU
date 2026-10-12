import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { safeAuthReturn } from '@/lib/auth-return';

/** Finish the existing PKCE flow and return only to a local application path. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeAuthReturn(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return redirect(new URL(next, url.origin));
    } catch { /* Failed exchanges return to login without forwarding codes or provider details. */ }
  }
  const login = new URL('/login', url.origin);
  if (next !== '/') login.searchParams.set('next', next);
  return redirect(login);
}

function redirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
