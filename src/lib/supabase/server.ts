import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * @fileOverview Server-side Supabase client.
 * 
 * Used in Server Components, Server Actions, and Route Handlers.
 * Handles cookie management to ensure session persistence across 
 * server-side requests.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // This is expected if called from a Server Component
          }
        },
      },
    }
  )
}

/**
 * Admin client with full database access.
 * USE WITH EXTREME CAUTION. Only for operations that bypass RLS.
 */
export async function createAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return [] },
        setAll() { }
      }
    }
  )
}
