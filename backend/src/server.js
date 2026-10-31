import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { createClient } from '@supabase/supabase-js'
import { paymentsAnalyticsRouter } from './payments/index.ts'
import { startBillingSchedule } from './billing/index.ts'

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const app = express()
const port = Number(process.env.PORT || 4000)
const supabaseUrl = process.env.SUPABASE_URL
const serviceClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', exposedHeaders: ['X-Response-Time'] }))
app.use(express.json({ limit: '32kb' }))

function getUserClient(token) {
  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function requireUser(req, res, next) {
  const authorization = req.headers.authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })

  const client = getUserClient(token)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' })

  req.user = data.user
  req.supabase = client
  next()
}

async function requireAdmin(req, res, next) {
  const { data: profile, error } = await req.supabase
    .from('profiles').select('role').eq('id', req.user.id).single()
  if (error || profile?.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' })
  next()
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api/finance', paymentsAnalyticsRouter())

app.get('/api/profile', requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from('profiles').select('*').eq('id', req.user.id).single()
  if (error) return res.status(404).json({ error: 'Profile not found.' })
  res.json({ profile: data })
})

app.get('/api/admin/profiles', requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await req.supabase
    .from('profiles').select('id,email,full_name,role,created_at').order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'Could not load profiles.' })
  res.json({ profiles: data })
})

app.post('/api/admin/staff', requireUser, requireAdmin, async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : ''
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !fullName) {
    return res.status(400).json({ error: 'Enter a valid email and full name.' })
  }

  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  })
  if (error) return res.status(400).json({ error: error.message })

  const { error: roleError } = await serviceClient.from('profiles')
    .update({ full_name: fullName, role: 'staff' }).eq('id', data.user.id)
  if (roleError) {
    return res.status(500).json({ error: 'Invite created, but staff role assignment failed. Retry from the admin dashboard.' })
  }
  res.status(201).json({ message: `Staff invitation sent to ${email}.` })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Unexpected server error.' })
})

startBillingSchedule()
app.listen(port, () => console.log(`Subflow API listening on port ${port}`))
