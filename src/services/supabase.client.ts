import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

function configuredCredentials(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

  if (!url || !key) {
    return null
  }

  try {
    const parsedUrl = new URL(url)
    if (!['https:', 'http:'].includes(parsedUrl.protocol) || !parsedUrl.hostname || key.length < 20) {
      return null
    }
  } catch {
    return null
  }

  return { url, key }
}

export function isSupabaseConfigured(): boolean {
  return configuredCredentials() !== null
}

export function getSupabaseClient(): SupabaseClient {
  if (client === undefined) {
    const credentials = configuredCredentials()
    client = credentials ? createClient(credentials.url, credentials.key) : null
  }

  if (!client) {
    throw new Error('Optional sync is not configured. Add the Supabase URL and publishable key to .env.local.')
  }

  return client
}

export async function signInToSync(email: string, password: string): Promise<User> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
  if (error) {
    throw error
  }
  if (!data.user) {
    throw new Error('Supabase did not return an authenticated user.')
  }
  return data.user
}

export async function signUpForSync(email: string, password: string): Promise<{ user: User; needsEmailConfirmation: boolean }> {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) {
    throw error
  }
  if (!data.user) {
    throw new Error('Supabase did not return an account.')
  }

  return {
    user: data.user,
    needsEmailConfirmation: !data.session,
  }
}

export async function signOutFromSync(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error) {
    throw error
  }
}
