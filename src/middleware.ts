import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy, createNonce } from '@/lib/security-headers'

/**
 * @fileOverview Next.js Middleware for Supabase Auth.
 * 
 * Responsibility: Refreshes the session token if it's expired
 * before the page or API route is reached.
 */
export async function updateSession(request: NextRequest, requestHeaders: Headers = new Headers(request.headers)) {
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // P0 FIX: Prevent crash if environment variables are missing
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // Forward the refreshed cookies alongside the nonce headers.
          requestHeaders.set('cookie', request.headers.get('cookie') ?? '')
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not remove getUser(). This refreshes the session.
  await supabase.auth.getUser()

  return supabaseResponse
}

export async function middleware(request: NextRequest) {
  // A fresh nonce per request (SEC-022). Next.js reads the policy from the request headers to tag its own scripts.
  const nonce = createNonce()
  const policy = contentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL, nonce, process.env.NODE_ENV === 'development')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)
  const response = await updateSession(request, requestHeaders)
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  // Vercel's own current guidance for Routing Middleware recommends the
  // Node.js runtime (stable since Next.js 15.5) over Edge.
  runtime: 'nodejs',
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
