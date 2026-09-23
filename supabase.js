/* ============================================================
   Onix Finance — Supabase Client
   Drop this file in the same folder as all your HTML files.
   Every page imports this to talk to the database.
   ============================================================ */

const SUPABASE_URL = 'https://ckayfqplkpplgojdhjlu.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrYXlmcXBsa3BwbGdvamRoamx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTUzNDUsImV4cCI6MjA5MzY3MTM0NX0.E5lmNud0ERUqaxy829d1dB3AqGw9EEFjHFSB7zDJdFE'

/* Load Supabase from CDN — no npm or build tools needed */
const { createClient } = window.supabase
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* ── Auth helpers ─────────────────────────────────────────── */

async function getSession() {
  const { data: { session } } = await _supabase.auth.getSession()
  return session
}

async function getProfile(userId) {
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) console.error('Profile fetch error:', error)
  return data
}

async function signOut() {
  localStorage.removeItem('onix-user')
  await _supabase.auth.signOut()
  window.location.href = 'login.html'
}

/* ── Auth gate helpers ────────────────────────────────────── */

/* Call this at the top of client-portal.html */
async function requireClient() {
  const session = await getSession()
  if (!session) { window.location.replace('login.html'); return null }
  const profile = await getProfile(session.user.id)
  // Matches login.html's own gate exactly: 'pending' and 'rejected' are
  // blocked there too, everything else (currently just 'met' and 'active')
  // is allowed to log in. This was previously status !== 'active' only,
  // which meant a 'met' client could pass login.html's form but then get
  // bounced straight back out the moment the portal page itself loaded.
  if (!profile || profile.role !== 'client' || profile.status === 'pending' || profile.status === 'rejected') {
    localStorage.removeItem('onix-user')
    await _supabase.auth.signOut()
    window.location.replace('login.html')
    return null
  }
  return { session, profile }
}

/* Call this at the top of admin-portal.html */
async function requireAdmin() {
  const session = await getSession()
  if (!session) { window.location.replace('login.html'); return null }
  const profile = await getProfile(session.user.id)
  // Must be admin/manager (AEs have role='admin') and not removed/rejected.
  // A team member that has been removed has status='rejected', locking them out.
  const STAFF_ROLES = ['admin', 'manager'];
  if (!profile || !STAFF_ROLES.includes(profile.role) || profile.status === 'rejected') {
    localStorage.removeItem('onix-user')
    await _supabase.auth.signOut()
    window.location.replace('login.html')
    return null
  }
  return { session, profile }
}

/* ── Data fetching — Client ───────────────────────────────── */

async function getMyLoan(userId) {
  // A user can technically have more than one loan in the DB. Pick the most
  // recently created ACTIVE one for the dashboard summary. Falls back to the
  // most recent of any status if none are active.
  // Excludes OUS Pasiva rows — those are deposits, not loans (see
  // getMyOusDeposits) and belong on the My Investments page instead.
  const { data, error } = await _supabase
    .from('loans')
    .select('*, loan_documents(*)')
    .eq('user_id', userId)
    .neq('data_source', 'ous_pasiva')
    .order('created_at', { ascending: false })
  if (error) { console.error('Loan fetch error:', error); return null }
  if (!data || !data.length) return null
  return data.find(l => l.status === 'active') || data[0]
}

async function getMyLoans(userId) {
  // Excludes OUS Pasiva rows — see getMyOusDeposits.
  const { data, error } = await _supabase
    .from('loans')
    .select('*, loan_documents(*)')
    .eq('user_id', userId)
    .neq('data_source', 'ous_pasiva')
    .order('created_at', { ascending: false })
  if (error) { console.error('Loans fetch error:', error); return [] }
  return data || []
}

async function getMyInvestments(userId) {
  const { data, error } = await _supabase
    .from('investments')
    .select('*, investment_documents(*)')
    .eq('user_id', userId)
  if (error) console.error('Investments fetch error:', error)
  return data || []
}

// Loans synced in automatically from the OUS Pasiva system are actually
// client deposits, not loans (confirmed by the team) — the admin portal
// already separates these the same way (see admin-portal-data.js). Fetched
// separately so the client portal can show them under My Investments
// instead of My Loan.
async function getMyOusDeposits(userId) {
  const { data, error } = await _supabase
    .from('loans')
    .select('*, loan_documents(*)')
    .eq('user_id', userId)
    .eq('data_source', 'ous_pasiva')
    .order('created_at', { ascending: false })
  if (error) { console.error('OUS deposits fetch error:', error); return [] }
  return data || []
}

async function getMyPayments(userId) {
  // RLS filters to the user's own loans; we still ask for loan rows so we can
  // show "Loan ONX-XXXX" alongside each payment.
  const { data, error } = await _supabase
    .from('loan_payments')
    .select('*, loans!inner(id, loan_id_display, user_id, data_source)')
    .eq('loans.user_id', userId)
    .order('due_date', { ascending: false })
  if (error) console.error('Payments fetch error:', error)
  return data || []
}

async function getMyDistributions(userId) {
  const { data, error } = await _supabase
    .from('distributions')
    .select('*, investments!inner(id, venture_name, user_id)')
    .eq('investments.user_id', userId)
    .order('paid_at', { ascending: false })
  if (error) console.error('Distributions fetch error:', error)
  return data || []
}

async function getOpenRaises() {
  const { data, error } = await _supabase
    .from('raises')
    .select('*, raise_documents(*)')
    .eq('status', 'open')
  if (error) console.error('Raises fetch error:', error)
  return data || []
}

async function submitLoanApplication(userId, formData) {
  const { data, error } = await _supabase
    .from('loan_applications')
    .insert([{ user_id: userId, ...formData }])
  if (error) { console.error('Application submit error:', error); return false }
  return true
}

async function submitRaiseInterest(userId, raiseId, extras) {
  const e = extras || {}
  const row = {
    user_id: userId,
    raise_id: raiseId,
    amount:         e.amount         != null ? Number(e.amount) : null,
    notes:          e.notes          || null,
    contact_method: e.contact_method || null,
    best_time:      e.best_time      || null
  }
  const { error } = await _supabase
    .from('raise_interests')
    .insert([row])
  if (error) { console.error('Interest submit error:', error); return false }
  return true
}

/* ── Data fetching — Admin ────────────────────────────────── */

async function getAllClients() {
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .order('created_at', { ascending: false })
  if (error) console.error('Clients fetch error:', error)
  return data || []
}

async function getPendingClients() {
  // Includes both 'pending' (new sign-up) and 'met' (admin has met them
  // in person, just hasn't activated their account yet).
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .in('status', ['pending', 'met'])
  if (error) console.error('Pending clients error:', error)
  return data || []
}

async function markClientMet(userId) {
  const { error } = await _supabase
    .from('profiles')
    .update({ status: 'met' })
    .eq('id', userId)
  return !error
}

async function approveClient(userId) {
  const { error } = await _supabase
    .from('profiles')
    .update({ status: 'active' })
    .eq('id', userId)
  return !error
}

async function rejectClient(userId) {
  const { error } = await _supabase
    .from('profiles')
    .update({ status: 'rejected' })
    .eq('id', userId)
  return !error
}

async function getAllLoans() {
  const { data, error } = await _supabase
    .from('loans')
    .select('*, profiles!user_id(full_name, email), loan_documents(*)')
    .order('created_at', { ascending: false })
  if (error) console.error('All loans error:', error)
  return data || []
}

async function getAllInvestments() {
  const { data, error } = await _supabase
    .from('investments')
    .select('*, profiles!user_id(full_name, email), investment_documents(*)')
    .order('created_at', { ascending: false })
  if (error) console.error('All investments error:', error)
  return data || []
}

async function getAllApplications() {
  const { data, error } = await _supabase
    .from('loan_applications')
    .select('*, profiles!user_id(full_name, email)')
    .order('submitted_at', { ascending: false })
  if (error) console.error('Applications error:', error)
  return data || []
}

async function getAllRaises() {
  const { data, error } = await _supabase
    .from('raises')
    .select('*, raise_documents(*)')
    .order('created_at', { ascending: false })
  if (error) console.error('Raises error:', error)
  return data || []
}

async function getAllPayments() {
  const { data, error } = await _supabase
    .from('loan_payments')
    .select('*, loans(id, loan_id_display, user_id, profiles!user_id(full_name, email))')
    .order('due_date', { ascending: false })
  if (error) console.error('All payments error:', error)
  return data || []
}

async function getAllDistributions() {
  const { data, error } = await _supabase
    .from('distributions')
    .select('*, investments(id, venture_name, user_id, profiles!user_id(full_name, email))')
    .order('paid_at', { ascending: false })
  if (error) console.error('All distributions error:', error)
  return data || []
}

async function getAllRaiseInterests() {
  const { data, error } = await _supabase
    .from('raise_interests')
    .select('*, raises(id, venture_name, venture_type, minimum_investment, status), profiles!user_id(full_name, email)')
    .order('submitted_at', { ascending: false })
  if (error) console.error('All raise interests error:', error)
  return data || []
}

async function getAllClientDocuments() {
  // category is needed by the Clients tab "missing document" filter so
  // it can tell which doc types each profile still needs.
  const { data, error } = await _supabase
    .from('client_documents')
    .select('id, profile_id, category')
  if (error) console.error('All client documents error:', error)
  return data || []
}

async function setRaiseInterestStatus(id, status) {
  const update = { status, responded_at: new Date().toISOString() }
  const { error } = await _supabase
    .from('raise_interests')
    .update(update)
    .eq('id', id)
  if (error) { console.error('Set raise interest status error:', error); return false }
  return true
}

/* ── Expose everything globally ───────────────────────────── */
window.OnixDB = {
  client: _supabase,
  getSession,
  getProfile,
  signOut,
  requireClient,
  requireAdmin,
  getMyLoan,
  getMyLoans,
  getMyOusDeposits,
  getMyInvestments,
  getMyPayments,
  getMyDistributions,
  getOpenRaises,
  submitLoanApplication,
  submitRaiseInterest,
  getAllClients,
  getPendingClients,
  markClientMet,
  approveClient,
  rejectClient,
  getAllLoans,
  getAllInvestments,
  getAllApplications,
  getAllRaises,
  getAllPayments,
  getAllDistributions,
  getAllRaiseInterests,
  setRaiseInterestStatus,
  getAllClientDocuments,
}
