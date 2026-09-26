import { createServerClient, type CookieOptions } from '@supabase/ssr'
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    console.warn('Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return createServerClient(
    url || 'https://placeholder.supabase.co',
    anonKey || 'placeholder',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    console.warn('Supabase admin credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createServerClient(
    url || 'https://placeholder.supabase.co',
    serviceRoleKey || 'placeholder',
    {
      cookies: {
        getAll() { return [] },
        setAll() { }
      }
    }
  )
}
