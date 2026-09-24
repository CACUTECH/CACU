
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * @fileOverview Auth callback route for Supabase PKCE flow.
 * 
 * Handles token exchange for:
 * - Email verification links
 * - Magic links
 * - Password reset links
 * - OAuth redirects (Google)
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Successful login/verification
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  // Fallback to home if no code or error
  return NextResponse.redirect(new URL('/login', request.url))
}
