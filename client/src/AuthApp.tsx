import { createContext, FormEvent, useContext, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BadgePercent, Bell, Check, CircleHelp, Command, Home, LogOut, Menu, Package, Shield, Users, X } from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { AppRole, isSupabaseConfigured, Profile, supabase } from './supabase'
import ProductWorkspace from './ProductWorkspace.jsx'
import FinancePage from './finance/FinancePage'
import './styles.css'

type AuthState = { session: Session | null; user: User | null; profile: Profile | null; loading: boolean; refreshProfile: () => Promise<void> }
const AuthContext = createContext<AuthState>({ session: null, user: null, profile: null, loading: true, refreshProfile: async () => {} })
const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = async () => {
    const { data: { session: active } } = await supabase.auth.getSession()
    setSession(active)
    if (!active) { setProfile(null); setLoading(false); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', active.user.id).maybeSingle()
    setProfile(data as Profile | null)
    setLoading(false)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    void refreshProfile()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { void refreshProfile() })
    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, refreshProfile }}>{children}</AuthContext.Provider>
}

function ConfigNotice() {
  return <main className="config-screen"><div className="config-card"><Brand /><span className="eyebrow">Setup needed</span><h1>Connect your Supabase project</h1><p>Add the project URL and publishable key to <code>client/.env</code>, then restart the frontend.</p><div className="setup-code">VITE_SUPABASE_URL=…<br />VITE_SUPABASE_ANON_KEY=…</div></div></main>
}

function Brand() { return <div className="brand"><span className="brand-mark"><Command size={18} strokeWidth={2.5} /></span><span>subflow<span className="brand-dot">.</span></span></div> }

function Field({ label, type = 'text', value, onChange, placeholder, required = true, readOnly = false }: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; readOnly?: boolean }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} readOnly={readOnly} /></label>
}

function AuthLayout({ children, title, subtitle, mode }: { children: React.ReactNode; title: string; subtitle: string; mode: 'login' | 'register' | 'reset' }) {
  return <main className="auth-shell"><section className="auth-art"><Brand /><div className="art-copy"><span className="eyebrow light">A calmer way to work</span><h2>Good work<br />flows from here.</h2><p>One clear space for your team, your work, and what comes next.</p><div className="art-card"><div className="art-card-top"><span className="tiny-orb" /><span>Workspace overview</span><span className="live-pill">LIVE</span></div><div className="art-bars"><i /><i /><i /><i /><i /><i /></div><div className="art-card-foot"><span>Weekly activity</span><b>+18.6%</b></div></div></div><div className="art-footer">Thoughtfully connected. Secure by design.</div></section><section className="auth-main"><div className="auth-mobile-brand"><Brand /></div><div className="auth-form-wrap"><span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : mode === 'register' ? 'GET STARTED' : 'ACCOUNT RECOVERY'}</span><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>{children}</div><p className="auth-legal">By continuing, you agree to our <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</p></section></main>
}

function LoginPage() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const navigate = useNavigate(); const location = useLocation()
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); setBusy(true); const { error: authError } = await supabase.auth.signInWithPassword({ email, password }); setBusy(false); if (authError) setError(authError.message); else navigate((location.state as { from?: string })?.from || '/app') }
  return <AuthLayout mode="login" title="Welcome back" subtitle="Enter your details to sign in to your workspace."><form className="form-stack" onSubmit={submit}><Field label="Email address" type="email" value={email} onChange={setEmail} placeholder="you@company.com" /><Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Enter your password" /><div className="form-between"><label className="check-label"><input type="checkbox" /> <span>Remember me</span></label><Link to="/reset">Forgot password?</Link></div>{error && <p className="form-error">{error}</p>}<button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button></form><p className="auth-switch">New to Subflow? <Link to="/register">Create an account</Link></p></AuthLayout>
}

function RegisterPage() {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } }); setBusy(false); if (signUpError) setError(signUpError.message); else setMessage('Check your email to confirm your account. Your account will start with customer access.') }
  return <AuthLayout mode="register" title="Create your account" subtitle="Get your workspace ready in just a few moments."><form className="form-stack" onSubmit={submit}><Field label="Full name" value={name} onChange={setName} placeholder="Your name" /><Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" /><Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" /><p className="field-hint">Use at least 8 characters for a stronger password.</p>{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-btn" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <ArrowRight size={17} /></button></form><p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p></AuthLayout>
}

function ResetPage() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); setMessage(''); const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/update-password` }); if (resetError) setError(resetError.message); else setMessage('If an account exists for that address, a reset link is on its way.') }
  return <AuthLayout mode="reset" title="Reset your password" subtitle="We’ll send you a link to choose a new password."><form className="form-stack" onSubmit={submit}><Field label="Email address" type="email" value={email} onChange={setEmail} placeholder="you@company.com" />{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-btn">Send reset link <ArrowRight size={17} /></button></form><p className="auth-switch"><Link to="/login">Back to sign in</Link></p></AuthLayout>
}

function UpdatePasswordPage() {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setMessage('')
    if (password.length < 8) { setError('Choose a password with at least 8 characters.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) setError(updateError.message)
    else { setMessage('Your password has been updated. You can now sign in with it.') }
  }
  return <AuthLayout mode="reset" title="Choose a new password" subtitle="Make it at least 8 characters long."><form className="form-stack" onSubmit={submit}><Field label="New password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" /><Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} placeholder="Enter it again" />{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-btn">Update password <ArrowRight size={17} /></button></form><p className="auth-switch"><Link to="/login">Back to sign in</Link></p></AuthLayout>
}

function Protected({ children, role }: { children: React.ReactNode; role?: AppRole }) {
  const { loading, user, profile } = useAuth(); const location = useLocation()
  if (loading) return <div className="loading-screen"><span className="spinner" /> Loading your workspace</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile) return <div className="loading-screen">Your profile is still being prepared. Refresh in a moment.</div>
  if (role && profile.role !== role) return <Navigate to={`/app/${profile.role}`} replace />
  return <>{children}</>
}

const menu = [
  { label: 'Overview', icon: Home, path: '' },
  { label: 'My profile', icon: Users, path: '/profile' },
  { label: 'Products & plans', icon: Package, path: '/catalog', admin: true },
  { label: 'Finance & reports', icon: BadgePercent, path: '/finance', finance: true },
  { label: 'Team members', icon: Users, path: '/team', admin: true },
]

function Workspace({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth(); const [open, setOpen] = useState(false)
  const role = profile?.role || 'customer'
  const roleTitle = role.charAt(0).toUpperCase() + role.slice(1)
  return <div className="workspace"><aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><div className="side-brand"><Brand /><button className="icon-btn side-close" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace-switch"><div className="workspace-avatar">S</div><div><b>Subflow workspace</b><span>{roleTitle} account</span></div><span className="switch-chevron">⌄</span></div><div className="side-label">WORKSPACE</div><nav className="side-nav">{menu.filter(item => (!item.admin || role === 'admin') && (!item.finance || role === 'admin' || role === 'staff')).map(item => <Link key={item.path} to={item.path ? `/app${item.path}` : `/app/${role}`} className={`side-link ${!item.path ? 'active' : ''}`} onClick={() => setOpen(false)}><item.icon size={17} /><span>{item.label}</span>{item.admin && <span className="nav-count">{role === 'admin' ? '›' : ''}</span>}</Link>)}</nav><div className="sidebar-bottom"><div className="help-box"><div className="help-icon"><CircleHelp size={16} /></div><b>Need a hand?</b><span>Our team is here to help.</span><a href="mailto:support@subflow.app">Visit help center <ArrowRight size={13} /></a></div><div className="side-profile"><div className="profile-avatar">{(profile?.full_name || profile?.email || 'U').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><b>{profile?.full_name || 'Your profile'}</b><span>{profile?.email}</span></div><button className="icon-btn logout-btn" title="Sign out" onClick={() => void supabase.auth.signOut()}><LogOut size={17} /></button></div></div></aside><div className="main-column"><header className="topbar"><button className="icon-btn menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">Workspace <span>/</span> <b>{roleTitle} overview</b></div><div className="top-actions"><button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={18} /><i /></button><div className="top-avatar">{(profile?.full_name || 'U').slice(0, 1).toUpperCase()}</div></div></header><main className="page-content">{children}</main></div>{open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}</div>
}

function DashboardPage() {
  const { profile } = useAuth(); const role = profile!.role; const title = role === 'admin' ? 'Admin dashboard' : role === 'staff' ? 'Staff dashboard' : 'Your dashboard'
  const subtitle = role === 'admin' ? 'Manage your people and keep the workspace moving.' : role === 'staff' ? 'Here’s what’s happening across your workspace.' : 'Everything you need, all in one place.'
  return <><div className="welcome-row"><div><span className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span><h1>{title}<span className="title-period">.</span></h1><p>{subtitle}</p></div><div className="welcome-actions"><button className="soft-btn"><CircleHelp size={16} /> Help center</button>{role === 'admin' && <Link className="primary-btn compact" to="/app/team">Manage team <ArrowRight size={16} /></Link>}</div></div><section className="welcome-banner"><div className="welcome-banner-copy"><span className="banner-kicker"><span className="banner-dot" /> YOUR WORKSPACE IS READY</span><h2>Welcome to Subflow, {profile?.full_name?.split(' ')[0] || 'there'}.</h2><p>Your workspace is set up. Start by inviting your team or exploring your dashboard.</p>{role === 'admin' && <Link to="/app/team" className="banner-link">Invite your team <ArrowRight size={15} /></Link>}</div><div className="banner-art" aria-hidden="true"><div className="banner-ring ring-one" /><div className="banner-ring ring-two" /><div className="banner-chip chip-one"><Check size={13} /> Profile ready</div><div className="banner-chip chip-two"><Users size={14} /> Team workspace</div><div className="banner-orb"><Command size={34} /></div></div></section><div className="section-head"><div><h2>Workspace overview</h2><p>A quick look at your Subflow workspace.</p></div><button className="period-select">Last 30 days <span>⌄</span></button></div><section className="stat-grid"><StatCard label="Workspace status" value="All set" detail="Your account is active" icon="check" /><StatCard label="Your access" value={role[0].toUpperCase() + role.slice(1)} detail="Assigned workspace role" icon="shield" /><StatCard label="Profile" value="Complete" detail={profile?.email || 'Account connected'} icon="user" /></section><section className="bottom-grid"><div className="panel activity-panel"><div className="panel-heading"><div><h3>Recent activity</h3><p>Stay up to date with your workspace.</p></div><button className="more-btn">···</button></div><div className="empty-activity"><div className="empty-icon"><Check size={18} /></div><b>You’re all caught up</b><span>New activity will show up here as it happens.</span></div></div><div className="panel quick-panel"><div className="panel-heading"><div><h3>Quick links</h3><p>Jump right back into your work.</p></div></div><Link to={`/app/${role}`} className="quick-link"><span className="quick-icon"><Home size={16} /></span><span><b>Dashboard overview</b><small>See your workspace at a glance</small></span><ArrowRight size={16} /></Link>{role === 'admin' && <Link to="/app/team" className="quick-link"><span className="quick-icon"><Users size={16} /></span><span><b>Manage your team</b><small>View members and invite staff</small></span><ArrowRight size={16} /></Link>}<a href="mailto:support@subflow.app" className="quick-link"><span className="quick-icon"><CircleHelp size={16} /></span><span><b>Get support</b><small>We’re happy to help</small></span><ArrowRight size={16} /></a></div></section></>
}

function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${icon}`}>{icon === 'shield' ? <Shield size={17} /> : icon === 'user' ? <Users size={17} /> : <Check size={17} />}</span></div><strong>{value}</strong><p>{detail}</p></div>
}

function TeamPage() {
  const { session } = useAuth(); const [profiles, setProfiles] = useState<Profile[]>([]); const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
  const load = async () => { if (!session?.access_token) return; const response = await fetch(`${apiUrl}/api/admin/profiles`, { headers: { Authorization: `Bearer ${session.access_token}` } }); const result = await response.json(); if (response.ok) setProfiles(result.profiles || []); else setError(result.error || 'Could not load team members.') }
  useEffect(() => { void load() }, [session?.access_token])
  const invite = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setMessage(''); setError(''); const response = await fetch(`${apiUrl}/api/admin/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ email, full_name: name }) }); const result = await response.json(); setBusy(false); if (!response.ok) setError(result.error || 'Invitation could not be sent.'); else { setMessage(result.message); setEmail(''); setName(''); void load() } }
  return <><div className="welcome-row team-title-row"><div><span className="eyebrow">PEOPLE</span><h1>Team members<span className="title-period">.</span></h1><p>Invite colleagues and manage access to your workspace.</p></div><span className="member-total"><Users size={16} /> {profiles.length} members</span></div><section className="panel invite-panel"><div className="panel-heading"><div><h3>Invite a staff member</h3><p>They’ll receive an email invitation to join your workspace.</p></div><span className="admin-badge"><Shield size={14} /> Admin only</span></div><form className="invite-form" onSubmit={invite}><Field label="Full name" value={name} onChange={setName} placeholder="Teammate name" /><Field label="Email address" type="email" value={email} onChange={setEmail} placeholder="name@company.com" /><button className="primary-btn invite-submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'} <ArrowRight size={16} /></button></form>{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}</section><section className="panel members-panel"><div className="panel-heading"><div><h3>Workspace members</h3><p>People who currently have access.</p></div><span className="member-total small-total">{profiles.length} total</span></div><div className="member-table"><div className="member-table-head"><span>MEMBER</span><span>ROLE</span><span>JOINED</span></div>{profiles.map(person => <div className="member-row" key={person.id}><div className="member-person"><div className="profile-avatar">{(person.full_name || person.email).slice(0, 1).toUpperCase()}</div><div><b>{person.full_name || 'Name not set'}</b><span>{person.email}</span></div></div><span className={`role-badge ${person.role}`}>{person.role}</span><span className="joined-date">{new Date(person.created_at).toLocaleDateString()}</span></div>)}{profiles.length === 0 && <div className="table-empty">No workspace members found.</div>}</div></section></>
}

function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.full_name || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(profile?.full_name || '') }, [profile?.full_name])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id)
    setBusy(false)
    if (saveError) setError(saveError.message)
    else { await refreshProfile(); setMessage('Your profile has been updated.') }
  }
  return <><div className="welcome-row team-title-row"><div><span className="eyebrow">ACCOUNT</span><h1>My profile<span className="title-period">.</span></h1><p>Keep your personal information up to date.</p></div></div><section className="panel invite-panel profile-panel"><div className="panel-heading"><div><h3>Personal information</h3><p>Your role is assigned by a workspace administrator.</p></div><span className={`role-badge ${profile!.role}`}>{profile!.role}</span></div><form className="profile-form" onSubmit={save}><Field label="Full name" value={name} onChange={setName} placeholder="Your name" /><Field label="Email address" type="email" value={profile!.email} onChange={() => {}} placeholder="you@company.com" required={false} readOnly /><p className="field-hint">To change your email, contact your workspace administrator.</p>{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-btn profile-save" disabled={busy}>{busy ? 'Saving…' : 'Save changes'} <Check size={16} /></button></form></section></>
}

function WorkspaceRoute() {
  if (window.location.pathname.endsWith('/team')) return <Protected role="admin"><Workspace><TeamPage /></Workspace></Protected>
  if (window.location.pathname.endsWith('/profile')) return <Protected><Workspace><ProfilePage /></Workspace></Protected>
  if (window.location.pathname.endsWith('/finance')) return <FinanceRoute />
  if (window.location.pathname.endsWith('/catalog')) return <Protected role="admin"><Workspace><ProductWorkspace /></Workspace></Protected>
  return <Protected><Workspace><DashboardPage /></Workspace></Protected>
}

function FinanceRoute() {
  const { profile, session } = useAuth()
  if (profile && profile.role === 'customer') return <Navigate to={`/app/${profile.role}`} replace />
  return <Protected><Workspace><FinancePage session={session} isAdmin={profile?.role === 'admin'} /></Workspace></Protected>
}

function App() {
  return <AuthProvider>{!isSupabaseConfigured ? <ConfigNotice /> : <Routes><Route path="/" element={<Navigate to="/app" replace />} /><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="/reset" element={<ResetPage />} /><Route path="/update-password" element={<UpdatePasswordPage />} /><Route path="/app" element={<AppHome />} /><Route path="/app/:role" element={<WorkspaceRoute />} /><Route path="/app/team" element={<WorkspaceRoute />} /><Route path="/app/profile" element={<WorkspaceRoute />} /><Route path="/app/catalog" element={<WorkspaceRoute />} /><Route path="/app/finance" element={<WorkspaceRoute />} /><Route path="*" element={<Navigate to="/app" replace />} /></Routes>}</AuthProvider>
}

function AppHome() { const { loading, user, profile } = useAuth(); if (loading) return <div className="loading-screen"><span className="spinner" /> Loading your workspace</div>; if (!user) return <Navigate to="/login" replace />; return <Navigate to={`/app/${profile?.role || 'customer'}`} replace /> }

export default App
