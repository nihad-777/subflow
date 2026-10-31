import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('your-project'))
export const supabase = createClient(
  url || 'https://example.supabase.co',
  anonKey || 'missing-anon-key',
)

export type AppRole = 'admin' | 'staff' | 'customer'
export type Profile = {
  id: string
  email: string
  full_name: string
  role: AppRole
  created_at: string
}
