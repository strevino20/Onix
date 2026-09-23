/**
 * Onix Finance — OUS Pasiva proxy
 * ================================================================
 * A tiny Express server that sits between the public Onix frontend
 * (served from GitHub Pages) and the OUS Pasiva REST API.
 *
 * Why this exists:
 *   - The browser must NEVER see the OUS login / password — we keep
 *     the credentials here in env vars and only expose a few proxied
 *     endpoints to the frontend.
 *   - OUS Pasiva tokens expire on the hour. This server logs in once
 *     on boot. It does NOT refresh on a timer — the OUS team asked us
 *     to stop creating fresh sessions every 55 minutes because each
 *     login showed up in their audit log. Instead, callOUS retries
 *     reactively when OUS returns 401 (so the first request after
 *     token expiry triggers a single re-login, not 24/day).
 *
 * Endpoints exposed to the Onix frontend:
 *   GET  /healthz                              — Railway health check
 *   GET  /api/catalogos                        — no body
 *   GET|POST /api/creditos-cierre-saldos       — body: { fecha_cierre }
 *   GET|POST /api/creditos/por-vencer          — body: { dias }
 *   POST /api/sync-run                         — runs the Pasiva sync now
 *   POST /api/activa-sync-run                  — runs the OUS Activa sync
 *     now (see runOUSActivaSync() — a deliberately separate integration,
 *     its own session/credentials/log table, not a Pasiva extension)
 *
 * Required environment variables (set these in Railway → Variables):
 *   OUS_LOGIN     — OUS Pasiva username
 *   OUS_PASSWORD  — OUS Pasiva password
 *   OUS_API_URL   — http://54.165.232.64:7070/api   (no trailing slash)
 *
 * Optional environment variables:
 *   PORT          — Railway sets this automatically (defaults to 3000 locally)
 *   ALLOWED_ORIGINS — comma-separated allowlist for CORS. Defaults to
 *                   the Vercel site + the custom domain.
 *   OUS_ACTIVA_LOGIN / OUS_ACTIVA_PASSWORD / OUS_ACTIVA_API_URL —
 *                   required only for /api/activa-sync-run; unset means
 *                   that route always fails with a clear "not configured"
 *                   error instead of touching the network.
 *   ACTIVA_SYNC_CRON_KEY — like SYNC_CRON_KEY, but Activa's own, separate
 *                   secret for its pg_cron path.
 *
 * Dependencies (see package.json):
 *   express, node-fetch
 *
 * Constraint reminder: only express + node-fetch are allowed. If you
 * find yourself reaching for axios / cors / dotenv etc., stop — the
 * tiny helpers below cover everything we need.
 * ================================================================
 */

'use strict';

const express = require('express');
const fetch   = require('node-fetch');
// Built-in Node modules — used for GET-with-body, which both
// node-fetch and the WHATWG fetch refuse to do despite the HTTP
// spec allowing it. Counts as a built-in, not an added dependency.
const http  = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const OUS_LOGIN    = process.env.OUS_LOGIN    || '';
const OUS_PASSWORD = process.env.OUS_PASSWORD || '';
const OUS_API_URL  = (process.env.OUS_API_URL || '').replace(/\/+$/, '');

// OUS Activa — separate credentials/session from OUS Pasiva above. Same
// underlying vendor is plausible (field shapes mirror each other closely)
// but unconfirmed, so this is treated as a fully independent system until
// proven otherwise: its own env vars, its own login/session state
// (stateActiva, below), its own base URL. Unset by default — the Activa
// sync route fails fast with a clear "not configured" error rather than
// attempting any network call when these are empty.
const OUS_ACTIVA_LOGIN    = process.env.OUS_ACTIVA_LOGIN    || '';
const OUS_ACTIVA_PASSWORD = process.env.OUS_ACTIVA_PASSWORD || '';
const OUS_ACTIVA_API_URL  = (process.env.OUS_ACTIVA_API_URL || '').replace(/\/+$/, '');

// Supabase auth gate for /api/* — validates each request's Supabase
// session token against Supabase's /auth/v1/user endpoint so the public
// Railway URL stops being an open back door into the OUS data. We use
// the user endpoint rather than verifying the JWT locally because
// Supabase projects can sign tokens with either HS256 (legacy shared
// secret) or asymmetric algorithms like ES256 — the user endpoint
// validates them all and saves us a dependency.
//
// SUPABASE_URL + SUPABASE_ANON_KEY power both the auth check and the
// per-request role lookup against the public.profiles table.
const SUPABASE_URL              = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY || '';
// SUPABASE_SERVICE_ROLE_KEY is only used by the OUS sync job (creates
// placeholder auth users + bypasses RLS on upserts). Not required for
// day-to-day proxy traffic.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// Shared secret for the scheduled sync trigger (pg_cron sends it in the
// X-Cron-Key header). Not required for the manual admin-triggered path.
const SYNC_CRON_KEY             = process.env.SYNC_CRON_KEY || '';
// Separate cron secret for the Activa sync — deliberately not the same
// value as SYNC_CRON_KEY, so a leaked key only ever exposes one of the
// two sync routes, not both.
const ACTIVA_SYNC_CRON_KEY      = process.env.ACTIVA_SYNC_CRON_KEY || '';

// Minimum gap, in ms, enforced between consecutive outbound calls to each
// OUS API — see createThrottle() near callOUS()/callOUSActiva() below.
// Kept separate per API (like every other piece of OUS state in this
// file) since Pasiva and Activa are treated as independent systems even
// though they share a vendor. 500ms is a conservative starting point, not
// a number OUS gave us — nothing in the docs specifies an actual limit.
const OUS_MIN_REQUEST_INTERVAL_MS        = Number(process.env.OUS_MIN_REQUEST_INTERVAL_MS)        || 500;
const OUS_ACTIVA_MIN_REQUEST_INTERVAL_MS = Number(process.env.OUS_ACTIVA_MIN_REQUEST_INTERVAL_MS)  || 500;

// Inbound rate limiting for /api/* — separate from the outbound OUS
// throttle above, and covers a real gap: nothing previously limited how
// often a caller could hit this proxy directly (bypassing the frontend
// entirely). Login/signup/reset already have Supabase Auth's own limits;
// this is everything else. Per-IP, fixed window, generous enough not to
// bother a handful of admins clicking around — meant to catch abuse or a
// runaway client loop, not normal use. /healthz is exempt (Railway polls
// it on its own schedule) since the limiter is only mounted on /api.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const RATE_LIMIT_MAX       = Number(process.env.RATE_LIMIT_MAX)       || 120;

const PORT = Number(process.env.PORT) || 3000;

// Comma-separated allowlist. Empty entries are ignored. The defaults
// cover the current Vercel site and the custom domain (see README §9).
// Add http://localhost:8000 here while developing the frontend locally
// if needed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://onix-red.vercel.app,https://portal.onixfinance.com'
).split(',').map(s => s.trim()).filter(Boolean);

// If the boot login fails (wrong creds, OUS down), retry on this
// cadence. Routes 503 in the meantime.
const BOOT_RETRY_MS = 60 * 1000;

if (!OUS_LOGIN || !OUS_PASSWORD || !OUS_API_URL) {
  console.error('[ous-proxy] FATAL: OUS_LOGIN, OUS_PASSWORD, and OUS_API_URL must all be set.');
  console.error('[ous-proxy] Got OUS_LOGIN=' + JSON.stringify(OUS_LOGIN ? '(set)' : '') +
                ' OUS_PASSWORD=' + JSON.stringify(OUS_PASSWORD ? '(set)' : '') +
                ' OUS_API_URL=' + JSON.stringify(OUS_API_URL));
  // We still start the server so Railway can reach /healthz and you
  // can see the misconfiguration in the dashboard instead of a
  // crash-looping container.
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[ous-proxy] FATAL: SUPABASE_URL / SUPABASE_ANON_KEY not set — /api/* will reject every request with 503. ' +
                'Set both in Railway → Variables: SUPABASE_URL=https://<project>.supabase.co and ' +
                'SUPABASE_ANON_KEY=<eyJ... from Supabase → Settings → API → API Keys>.');
}

// ---------------------------------------------------------------
// OUS auth state (kept in memory; one process = one token)
// ---------------------------------------------------------------

const state = {
  token: null,           // current OUS bearer token, or null when logged out
  acquiredAt: null,      // epoch ms when we last got the token (for /healthz)
  lastError: null,       // last login error message, or null on success
  bootTimer: null        // setTimeout handle for the retry-on-boot loop
};

/**
 * Log in to OUS Pasiva and store the token.
 *
 * ======================================================================
 *  ADJUST THIS FUNCTION WHEN YOU HAVE THE OUS PASIVA DOCS.
 *  The defaults below assume a very common Latin-American banking-API
 *  shape — they are an educated guess until the vendor sends us a curl
 *  example. Three things you may need to change:
 *
 *    1. LOGIN_PATH — '/login' is the most common; some APIs use
 *       '/auth/login', '/api/auth', or '/v1/sessions'. Strip the leading
 *       '/api' from OUS_API_URL if the login endpoint lives at the root.
 *    2. LOGIN_BODY — { login, password } is common; alternatives are
 *       { usuario, contrasena }, { user, pass }, { username, password }.
 *       Some APIs want form-encoded instead of JSON.
 *    3. tokenFromResponse() — the most common shape is { token: '...' };
 *       alternatives include { access_token: '...' }, { jwt: '...' },
 *       or a raw 'Authorization: Bearer X' response header.
 * ======================================================================
 */
async function loginToOUS() {
  // ---- ADJUST THESE THREE LINES IF NEEDED -------------------------
  // Confirmed by the OUS team on 2026-06-16: the real login endpoint
  // is POST /api/auth/login, NOT /api/login (which is a protected
  // resource that returns 401 "Token requerido").
  const LOGIN_PATH = '/auth/login';
  const LOGIN_BODY = { login: OUS_LOGIN, password: OUS_PASSWORD };
  // Confirmed shape from OUS Pasiva (2026-06-16):
  //   { status: 'ok', mensaje: 'Autenticación exitosa',
  //     data: { token: '...', tipo: 'Bearer', expira_en: ... } }
  // So the token lives at `data.token`. We also keep the top-level
  // fallbacks for any future shape change.
  const tokenFromResponse = (json, headers) =>
    (json.data && (json.data.token || json.data.access_token || json.data.jwt)) ||
    json.token || json.access_token || json.jwt ||
    headers.get('authorization') || null;
  // ----------------------------------------------------------------

  // Strip the password out of anything we're about to log or throw,
  // in case OUS ever echoes the request body back in an error response.
  const redact = (s) => OUS_PASSWORD
    ? String(s).split(OUS_PASSWORD).join('[redacted]')
    : String(s);

  const url = OUS_API_URL + LOGIN_PATH;
  console.log('[ous-proxy] login → POST ' + url +
              ' (body fields: ' + Object.keys(LOGIN_BODY).join(', ') + ')');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(LOGIN_BODY)
  });

  // Read the body once. Try JSON first, fall back to text so we can
  // log something useful when OUS returns HTML on error.
  const rawText = await res.text();
  let json = {};
  try { json = JSON.parse(rawText); } catch { /* not JSON */ }

  // Verbose logging so the Railway log tail tells us exactly what
  // happened on every login attempt — status, body shape, and which
  // key (if any) we extracted the token from.
  const contentType = res.headers.get('content-type') || '(no content-type)';
  console.log('[ous-proxy] login ← HTTP ' + res.status + ' ' + contentType +
              ' — body preview: ' + redact(rawText.slice(0, 400)));

  if (!res.ok) {
    throw new Error('OUS login HTTP ' + res.status + ': ' + redact((rawText || '').slice(0, 300)));
  }

  // Identify which field carried the token (helps spot when OUS
  // changes their response shape in the future).
  let tokenField = null;
  if (json.data && json.data.token)         tokenField = 'data.token';
  else if (json.data && json.data.access_token) tokenField = 'data.access_token';
  else if (json.data && json.data.jwt)      tokenField = 'data.jwt';
  else if (json.token)                       tokenField = 'token';
  else if (json.access_token)                tokenField = 'access_token';
  else if (json.jwt)                         tokenField = 'jwt';
  else if (res.headers.get('authorization')) tokenField = 'header:authorization';

  let token = tokenFromResponse(json, res.headers);
  // If the token came via an Authorization header it may be prefixed
  // with "Bearer "; strip it so we can re-add it consistently below.
  if (typeof token === 'string') token = token.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('OUS login succeeded (HTTP ' + res.status + ') but no token in response. ' +
      'Body was: ' + redact(JSON.stringify(json).slice(0, 300)));
  }

  state.token      = token;
  state.acquiredAt = Date.now();
  state.lastError  = null;
  console.log('[ous-proxy] OUS login OK at ' + new Date(state.acquiredAt).toISOString() +
              ' — token field=' + tokenField + ' length=' + token.length);
}

/**
 * Try to log in, recording any failure on `state.lastError`.
 * Returns true on success, false on failure (never throws).
 */
async function tryLogin(label) {
  try {
    await loginToOUS();
    return true;
  } catch (err) {
    state.token     = null;
    state.lastError = err && err.message ? err.message : String(err);
    console.error('[ous-proxy] ' + label + ' login failed:', state.lastError);
    return false;
  }
}

// ---------------------------------------------------------------
// OUS Activa auth state — fully independent of the `state` object
// above. Deliberately NOT wired into startAuthLoop()/boot: until
// OUS_ACTIVA_* env vars are confirmed and set, an eager boot-time
// login would just spam Railway's logs with failures for a feature
// nobody's using yet. Login happens lazily instead, the first time
// runOUSActivaSync() runs — same "sync-preflight" fallback
// runOUSSync() already uses for Pasiva internally (see below).
// ---------------------------------------------------------------
const stateActiva = {
  token: null,      // current OUS Activa bearer token, or null when logged out
  acquiredAt: null,
  lastError: null
};

// Set the first time runOUSActivaSync() observes /catalogos failing, so the
// "this endpoint doesn't actually exist" warning below logs once prominently
// instead of blending into the per-run fallback warning on every sync.
let catalogosMissingWarned = false;

/**
 * Log in to OUS Activa and store the token on stateActiva.
 *
 * ======================================================================
 *  CONFIRMED — POST { login, password } → { status, data: { token, tipo,
 *  expira_en } }, verified against the official OUS Activa API manual
 *  (§2) and a live Postman test, not inferred from Pasiva's shape. Same
 *  structure Pasiva happens to use, confirmed independently rather than
 *  assumed from it.
 * ======================================================================
 */
async function loginToOUSActiva() {
  if (!OUS_ACTIVA_LOGIN || !OUS_ACTIVA_PASSWORD || !OUS_ACTIVA_API_URL) {
    throw new Error('OUS Activa sync not configured: set OUS_ACTIVA_LOGIN + OUS_ACTIVA_PASSWORD + OUS_ACTIVA_API_URL');
  }

  const LOGIN_PATH = '/auth/login';
  const LOGIN_BODY = { login: OUS_ACTIVA_LOGIN, password: OUS_ACTIVA_PASSWORD };
  const tokenFromResponse = (json, headers) =>
    (json.data && (json.data.token || json.data.access_token || json.data.jwt)) ||
    json.token || json.access_token || json.jwt ||
    headers.get('authorization') || null;

  const redact = (s) => OUS_ACTIVA_PASSWORD
    ? String(s).split(OUS_ACTIVA_PASSWORD).join('[redacted]')
    : String(s);

  const url = OUS_ACTIVA_API_URL + LOGIN_PATH;
  console.log('[ous-activa-proxy] login → POST ' + url +
              ' (body fields: ' + Object.keys(LOGIN_BODY).join(', ') + ')');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(LOGIN_BODY)
  });

  const rawText = await res.text();
  let json = {};
  try { json = JSON.parse(rawText); } catch { /* not JSON */ }

  const contentType = res.headers.get('content-type') || '(no content-type)';
  console.log('[ous-activa-proxy] login ← HTTP ' + res.status + ' ' + contentType +
              ' — body preview: ' + redact(rawText.slice(0, 400)));

  if (!res.ok) {
    throw new Error('OUS Activa login HTTP ' + res.status + ': ' + redact((rawText || '').slice(0, 300)));
  }

  let token = tokenFromResponse(json, res.headers);
  if (typeof token === 'string') token = token.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('OUS Activa login succeeded (HTTP ' + res.status + ') but no token in response. ' +
      'Body was: ' + redact(JSON.stringify(json).slice(0, 300)));
  }

  stateActiva.token      = token;
  stateActiva.acquiredAt = Date.now();
  stateActiva.lastError  = null;
  console.log('[ous-activa-proxy] OUS Activa login OK at ' + new Date(stateActiva.acquiredAt).toISOString() +
              ' — token length=' + token.length);
}

/**
 * Try to log in to OUS Activa, recording any failure on
 * `stateActiva.lastError`. Returns true on success, false on failure
 * (never throws).
 */
async function tryLoginActiva(label) {
  try {
    await loginToOUSActiva();
    return true;
  } catch (err) {
    stateActiva.token     = null;
    stateActiva.lastError = err && err.message ? err.message : String(err);
    console.error('[ous-activa-proxy] ' + label + ' login failed:', stateActiva.lastError);
    return false;
  }
}

/**
 * Boot loop: try once immediately, then retry every BOOT_RETRY_MS
 * until we get a token. Once successful, no further proactive logins
 * are scheduled — the OUS team asked us to stop creating a fresh
 * session every 55 minutes. Token renewal happens reactively in
 * callOUS() the next time OUS returns 401, so we average one login
 * per token-expiry-window instead of one every hour regardless.
 */
async function startAuthLoop() {
  const ok = await tryLogin('initial');
  if (ok) return;
  // Failed — schedule a retry. clearTimeout-safe so multiple calls
  // don't pile up duplicate timers.
  if (state.bootTimer) clearTimeout(state.bootTimer);
  state.bootTimer = setTimeout(startAuthLoop, BOOT_RETRY_MS);
}

// ---------------------------------------------------------------
// OUS request helper — adds the bearer header, retries once on 401
// ---------------------------------------------------------------

// Low-level helper: do an HTTP request that *can* carry a body even
// when the method is GET. The HTTP spec technically allows it, but
// both the WHATWG fetch and node-fetch refuse to send it. OUS
// requires it for /creditos-cierre-saldos and /creditos/por-vencer
// (confirmed in Postman) so we drop down to Node's built-in http
// module here. Returns { status, headers, text }.
function rawHttpRequest(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const reqOpts = {
      method,
      protocol: u.protocol,
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + (u.search || ''),
      headers:  Object.assign({}, headers)
    };
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    if (payload != null) reqOpts.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers,
        text:    Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('OUS request timed out after ' + timeoutMs + 'ms')));
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------
// Outbound rate limiting — OUS Pasiva / OUS Activa
// ---------------------------------------------------------------
// Nothing throttled outbound OUS calls before this: not the periodic
// sync loops, not the admin-triggered passthrough endpoints
// (/api/catalogos etc.), not /api/ous-capture's Promise.all of 3
// simultaneous calls. createThrottle() serializes every real network
// call made through one throttled function into a single queue and
// enforces a minimum gap between them, so a burst (several admins
// clicking around, or a Promise.all) turns into evenly-spaced requests
// instead of a spike. A queued call that throws doesn't block the ones
// behind it.
//
// loginToOUS()/loginToOUSActiva() (the actual OUS_LOGIN/PASSWORD POST) are
// also NOT wrapped by this throttle, deliberately, not by oversight:
//   - Boot login (startAuthLoop) fires once at process start.
//   - Sync-preflight login (runOUSSync/runOUSActivaSync) fires at most
//     once per 15-minute cron cycle, before any queued call.
//   - Reactive 401 relogin is called from inside callOUSRequest() /
//     callOUSActivaRequest() themselves, so it already runs one-at-a-time
//     as a side effect of those functions being serialized by this
//     throttle — a burst of expired-token calls can no longer trigger
//     multiple simultaneous logins the way it could before this change;
//     only the one queued call that hits the 401 re-logs in, and every
//     call behind it in the queue reuses the fresh token.
// Throttling login directly would just add latency to the very call
// that's trying to unblock the queue, for no real benefit — and login is
// already deliberately minimized elsewhere (see the file header: OUS
// asked us to stop creating a fresh session every 55 minutes, so we only
// ever log in reactively on a 401, not on a timer).
//
// Deliberately wraps only callOUS()/callOUSActiva() — /diagnose and
// /diagnose-data build their own requests directly (via fetch/
// rawHttpRequest, including to non-OUS hosts) specifically so they can
// fire many requests in parallel and compare results; they never call
// these functions, so they're naturally unaffected without any
// special-case code here.
function createThrottle(minIntervalMs) {
  let queue = Promise.resolve();
  let lastStartedAt = 0;

  return function throttled(fn) {
    const run = async () => {
      const wait = Math.max(0, lastStartedAt + minIntervalMs - Date.now());
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastStartedAt = Date.now();
      return fn();
    };
    const result = queue.then(run, run);
    // Keep the queue alive even after a failed call, but don't let that
    // failure surface anywhere except the caller who made this request.
    queue = result.then(() => {}, () => {});
    return result;
  };
}

// NOTE: OUS_MIN_REQUEST_INTERVAL_MS's 500ms default (see Config section
// above) is a conservative default we picked in the absence of any
// documented rate limit from OUS — not a number OUS actually gave us.
// Adjust via env var if a real limit ever surfaces.
const throttleOUS       = createThrottle(OUS_MIN_REQUEST_INTERVAL_MS);
// Same caveat as throttleOUS above: OUS_ACTIVA_MIN_REQUEST_INTERVAL_MS's
// 500ms default is our own conservative guess, not an OUS-confirmed limit.
const throttleOUSActiva = createThrottle(OUS_ACTIVA_MIN_REQUEST_INTERVAL_MS);

async function callOUS(path, opts) {
  return throttleOUS(() => callOUSRequest(path, opts));
}

async function callOUSRequest(path, { method = 'GET', body = null } = {}) {
  if (!state.token) {
    const err = new Error('OUS proxy is not logged in yet');
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }
  const url = OUS_API_URL + (path.startsWith('/') ? path : '/' + path);
  const baseHeaders = {
    'Authorization': 'Bearer ' + state.token,
    'Accept':        'application/json'
  };

  // GET-with-body needs the raw http path (fetch refuses). All other
  // combinations go through node-fetch which gives us nicer ergonomics.
  const useRaw = (method === 'GET' || method === 'HEAD') && body != null;

  const doRequest = async () => {
    if (useRaw) {
      const r = await rawHttpRequest(url, {
        method, body,
        headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json' })
      });
      return { status: r.status, rawText: r.text };
    }
    const init = { method, headers: Object.assign({}, baseHeaders) };
    if (body != null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const rawText = await res.text();
    return { status: res.status, rawText };
  };

  let r = await doRequest();

  // Token may have expired mid-flight — try one re-login and retry.
  if (r.status === 401) {
    console.warn('[ous-proxy] got 401 from OUS — re-logging in and retrying');
    const ok = await tryLogin('reactive');
    if (ok) {
      baseHeaders.Authorization = 'Bearer ' + state.token;
      r = await doRequest();
    }
  }

  let json;
  try { json = JSON.parse(r.rawText); } catch { json = { raw: r.rawText }; }
  return { status: r.status, body: json };
}

// Activa's equivalent of callOUS() above — same shape (401 retry via
// tryLoginActiva, GET-with-body via rawHttpRequest), but reads/writes
// stateActiva + OUS_ACTIVA_API_URL exclusively. rawHttpRequest() is a
// pure low-level HTTP helper with no session state of its own, so it's
// shared as-is between both — the thing being kept independent here is
// the token/session, not this kind of stateless plumbing.
async function callOUSActiva(path, opts) {
  return throttleOUSActiva(() => callOUSActivaRequest(path, opts));
}

async function callOUSActivaRequest(path, { method = 'GET', body = null } = {}) {
  if (!stateActiva.token) {
    const err = new Error('OUS Activa proxy is not logged in yet');
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }
  const url = OUS_ACTIVA_API_URL + (path.startsWith('/') ? path : '/' + path);
  const baseHeaders = {
    'Authorization': 'Bearer ' + stateActiva.token,
    'Accept':        'application/json'
  };

  const useRaw = (method === 'GET' || method === 'HEAD') && body != null;

  const doRequest = async () => {
    if (useRaw) {
      const r = await rawHttpRequest(url, {
        method, body,
        headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json' })
      });
      return { status: r.status, rawText: r.text };
    }
    const init = { method, headers: Object.assign({}, baseHeaders) };
    if (body != null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const rawText = await res.text();
    return { status: res.status, rawText };
  };

  let r = await doRequest();

  if (r.status === 401) {
    console.warn('[ous-activa-proxy] got 401 from OUS Activa — re-logging in and retrying');
    const ok = await tryLoginActiva('reactive');
    if (ok) {
      baseHeaders.Authorization = 'Bearer ' + stateActiva.token;
      r = await doRequest();
    }
  }

  let json;
  try { json = JSON.parse(r.rawText); } catch { json = { raw: r.rawText }; }
  return { status: r.status, body: json };
}

// ---------------------------------------------------------------
// Express app
// ---------------------------------------------------------------

const app = express();

// Railway's own docs (docs.railway.com/networking/edge-networking) describe
// the request path as User -> Edge POP -> Internal Routing -> Deployment ->
// Your Service — two proxy hops (the edge POP that terminates TLS, then the
// internal hop to the deployment region), not one. Trusting only 1 hop was
// confirmed live to break the /api/* rate limiter below: req.ip resolved to
// Railway's internal routing address instead of the real client, which
// varies per request, so the per-IP bucket never accumulated (thousands of
// requests from one real IP, zero ever hit the limit). Trusting 2 hops
// matches Railway's documented topology and was verified to recover the
// real client IP.
app.set('trust proxy', 2);

// Accept JSON bodies on every route. The two data endpoints below
// honor the prompt's "GET … accepts a body" wording, so we use
// express.json() which works for both GET and POST.
app.use(express.json({ limit: '64kb' }));

// CORS middleware. Allowlist comes from ALLOWED_ORIGINS env var (or
// the default GH Pages + custom-domain pair). OPTIONS preflight is
// answered immediately so the browser is happy.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Tiny request logger so Railway's log tail is readable.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log('[ous-proxy] ' + req.method + ' ' + req.originalUrl +
                ' ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });
  next();
});

// Inbound rate limiting for /api/* — see RATE_LIMIT_WINDOW_MS/MAX in the
// Config section above for why this exists. In-memory, per-IP, fixed
// window: simple on purpose, matches this file's "no new dependencies"
// rule, and is fine for a single Railway instance (no need for anything
// shared/distributed at this traffic level).
const rateLimitBuckets = new Map(); // ip -> { count, windowStart }

function rateLimiter(req, res, next) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterS = Math.max(1, Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterS));
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  }
  next();
}
app.use('/api', rateLimiter);

// Sweep IPs that haven't made a request in a while so this Map doesn't
// grow forever from one-off callers (scanners, transient clients). Runs
// far less often than the window itself closes — this is cleanup, not
// part of the rate-limit logic.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, bucket] of rateLimitBuckets) {
    if (bucket.windowStart < cutoff) rateLimitBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS * 10).unref();

// -------- Health check ----------------------------------------
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    ous_logged_in: !!state.token,
    token_acquired_at: state.acquiredAt ? new Date(state.acquiredAt).toISOString() : null,
    uptime_s: Math.round(process.uptime())
  });
});

// -------- Data-shape probe ------------------------------------
// Fires the same parameterized request to OUS many different ways
// and reports back what each one returns. Lets us figure out
// whether OUS reads from query, JSON body, form body, etc. without
// redeploying for every guess.
app.get('/diagnose-data', requireSupabaseAuth, requireOnixAdmin, async (req, res) => {
  if (!state.token) {
    return res.status(503).json({ error: 'OUS proxy is not logged in yet' });
  }
  const fecha_cierre = req.query.fecha_cierre || new Date().toISOString().slice(0, 10);
  const base = OUS_API_URL + '/creditos-cierre-saldos';
  const auth = 'Bearer ' + state.token;
  const formBody = 'fecha_cierre=' + encodeURIComponent(fecha_cierre);
  const jsonBody = JSON.stringify({ fecha_cierre });
  const camelJson = JSON.stringify({ fechaCierre: fecha_cierre });

  const variants = [
    // ID, method, url, headers, body
    ['GET  body=JSON',          'GET',  base,                                    { 'Content-Type': 'application/json', Accept: 'application/json' },           jsonBody],
    ['GET  body=form',          'GET',  base,                                    { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, formBody],
    ['GET  query only',         'GET',  base + '?fecha_cierre=' + fecha_cierre,  { Accept: 'application/json' },                                                null],
    ['GET  query + JSON body',  'GET',  base + '?fecha_cierre=' + fecha_cierre,  { 'Content-Type': 'application/json', Accept: 'application/json' },           jsonBody],
    ['GET  query + form body',  'GET',  base + '?fecha_cierre=' + fecha_cierre,  { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, formBody],
    ['GET  body=JSON camel',    'GET',  base,                                    { 'Content-Type': 'application/json', Accept: 'application/json' },           camelJson],
    ['POST body=JSON',          'POST', base,                                    { 'Content-Type': 'application/json', Accept: 'application/json' },           jsonBody],
    ['POST body=form',          'POST', base,                                    { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, formBody],
    ['POST query only',         'POST', base + '?fecha_cierre=' + fecha_cierre,  { Accept: 'application/json' },                                                null]
  ];

  const results = await Promise.all(variants.map(async ([id, method, url, hdrs, body]) => {
    try {
      const r = await rawHttpRequest(url, {
        method,
        headers: Object.assign({ Authorization: auth }, hdrs),
        body
      });
      return { id, status: r.status, body_preview: (r.text || '').slice(0, 200) };
    } catch (err) {
      return { id, error: (err && err.message) || String(err) };
    }
  }));
  res.json({ fecha_cierre, results });
});

// -------- Exhaustive connectivity diagnostic ------------------
// Runs ~12 outbound tests in parallel from Railway and reports each
// status + timing so we can isolate: is it Railway, is it OUS, is
// it the specific port, is it the User-Agent, etc.
app.get('/diagnose', requireSupabaseAuth, requireOnixAdmin, async (req, res) => {
  const tests = [
    // --- General internet: prove Railway's outbound is healthy ---
    { id: 'cloudflare-1.1.1.1', url: 'https://1.1.1.1', method: 'GET' },
    { id: 'github-api',         url: 'https://api.github.com', method: 'GET' },
    { id: 'example.com',        url: 'https://example.com', method: 'GET' },

    // --- OUS on its documented port + path ---
    { id: 'ous-7070-login-default-ua', url: 'http://54.165.232.64:7070/api/auth/login', method: 'POST',
      body: { login: OUS_LOGIN, password: OUS_PASSWORD } },

    // --- OUS with mimicked Postman User-Agent (rules out UA filtering) ---
    { id: 'ous-7070-login-postman-ua', url: 'http://54.165.232.64:7070/api/auth/login', method: 'POST',
      headers: { 'User-Agent': 'PostmanRuntime/7.36.0' },
      body: { login: OUS_LOGIN, password: OUS_PASSWORD } },

    // --- OUS on alternate ports (in case 7070 is firewalled but 443/80 aren't) ---
    { id: 'ous-port-443',  url: 'https://54.165.232.64:443/api/auth/login',  method: 'POST', body: { login: OUS_LOGIN, password: OUS_PASSWORD } },
    { id: 'ous-port-80',   url: 'http://54.165.232.64:80/api/auth/login',    method: 'POST', body: { login: OUS_LOGIN, password: OUS_PASSWORD } },
    { id: 'ous-port-8080', url: 'http://54.165.232.64:8080/api/auth/login',  method: 'POST', body: { login: OUS_LOGIN, password: OUS_PASSWORD } },
    { id: 'ous-port-8443', url: 'https://54.165.232.64:8443/api/auth/login', method: 'POST', body: { login: OUS_LOGIN, password: OUS_PASSWORD } },

    // --- OUS with HTTPS scheme on the documented port ---
    { id: 'ous-7070-https', url: 'https://54.165.232.64:7070/api/auth/login', method: 'POST',
      body: { login: OUS_LOGIN, password: OUS_PASSWORD } },

    // --- Bare TCP touch on the OUS port (GET, no body, short timeout) ---
    { id: 'ous-7070-root-get', url: 'http://54.165.232.64:7070/', method: 'GET' },

    // --- Catalogos without auth (any HTTP response proves the port is reachable) ---
    { id: 'ous-7070-catalogos-noauth', url: 'http://54.165.232.64:7070/api/catalogos', method: 'GET' }
  ];

  const runTest = async (t) => {
    const start = Date.now();
    try {
      const ctl = new AbortController();
      const to  = setTimeout(() => ctl.abort(), 12000);
      const headers = Object.assign(
        { 'Accept': 'application/json' },
        t.body ? { 'Content-Type': 'application/json' } : {},
        t.headers || {}
      );
      const r = await fetch(t.url, {
        method:  t.method,
        headers: headers,
        body:    t.body ? JSON.stringify(t.body) : undefined,
        signal:  ctl.signal
      });
      clearTimeout(to);
      const text = await r.text();
      let bodyPreview;
      try { bodyPreview = JSON.parse(text); } catch { bodyPreview = (text || '').slice(0, 200); }
      return {
        id: t.id, url: t.url, method: t.method,
        status: r.status,
        content_type: r.headers.get('content-type'),
        ms: Date.now() - start,
        body_preview: typeof bodyPreview === 'string' ? bodyPreview : JSON.stringify(bodyPreview).slice(0, 200)
      };
    } catch (err) {
      return {
        id: t.id, url: t.url, method: t.method,
        ms: Date.now() - start,
        error_name: err && err.name,
        error_code: err && err.code,
        error_message: (err && err.message || '').slice(0, 200)
      };
    }
  };

  // Run in parallel — total wall time should be ~12 s (the longest single timeout).
  const results = await Promise.all(tests.map(runTest));
  res.json({
    proxy_uptime_s: Math.round(process.uptime()),
    ous_logged_in:  !!state.token,
    ran_at:         new Date().toISOString(),
    tests:          results
  });
});

// -------- Guard: 503 the data routes when not logged in --------
function requireOUSLogin(req, res, next) {
  if (!state.token) {
    return res.status(503).json({
      error: 'OUS proxy is not logged in yet',
      detail: state.lastError || 'Initial login still pending or failing.'
    });
  }
  next();
}

// -------- Guard: validate the caller's Supabase session token ----
// Reads "Authorization: Bearer <jwt>" and validates it by asking
// Supabase's /auth/v1/user endpoint who it belongs to. Algorithm-
// agnostic (works for HS256, ES256, RS256). On success attaches
// req.user with { id, email, raw_token, raw_payload }. Returns 401
// on missing/invalid/expired token. This is the baseline gate —
// without it the Railway URL is an open door (see README §SECURITY).
async function requireSupabaseAuth(req, res, next) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Auth not configured — SUPABASE_URL/SUPABASE_ANON_KEY missing on server' });
  }
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing Authorization: Bearer <supabase access token>' });
  const token = m[1].trim();
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Accept':        'application/json'
      }
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(401).json({
        error:  'Invalid or expired token',
        detail: 'Supabase /auth/v1/user returned HTTP ' + r.status + ': ' + body.slice(0, 200)
      });
    }
    const user = await r.json();
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Token did not resolve to a user' });
    }
    req.user = {
      id:          user.id,
      email:       user.email,
      raw_token:   token,
      raw_payload: user
    };
    next();
  } catch (err) {
    return res.status(503).json({ error: 'Auth check threw', detail: (err && err.message) || String(err) });
  }
}

// -------- Guard: caller's profile row must have role='admin' ----
// JWT verification alone proves the caller is *some* Supabase user,
// not that they're an Onix admin. We confirm by re-issuing their own
// JWT against the public.profiles table — RLS lets a user read their
// own profile only, which is exactly what we need. Fails closed.
async function requireOnixAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Admin check not configured — SUPABASE_URL/SUPABASE_ANON_KEY missing on server' });
  }
  try {
    const url = SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(req.user.id) + '&select=role,status';
    const r = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + req.user.raw_token,
        'Accept':        'application/json'
      }
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(403).json({ error: 'Profile lookup failed', detail: 'HTTP ' + r.status + ': ' + body.slice(0, 200) });
    }
    const rows = await r.json();
    const p = Array.isArray(rows) ? rows[0] : null;
    const ADMIN_ROLES = ['admin', 'manager'];
    if (!p || !ADMIN_ROLES.includes(p.role) || p.status !== 'active') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    req.user.role   = p.role;
    req.user.status = p.status;
    next();
  } catch (err) {
    return res.status(503).json({ error: 'Admin check threw', detail: (err && err.message) || String(err) });
  }
}

// Blocks account executives (profiles.title = 'ae') from a specific route
// without restricting them from the shared admin surface — requireOnixAdmin
// above already confirmed role/status; this adds the one further title
// check a route needs. Deliberately not folded into requireOnixAdmin
// itself, since AEs still need normal admin access to everything else
// (OUS data, syncs, etc.) — composed only onto the routes that actually
// need it (activa-create-client today). Mirrors the same is_ae() rule
// admin_create_client() enforces at the database level for the other
// client-creation path.
async function requireNotAE(req, res, next) {
  try {
    const url = SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(req.user.id) + '&select=title';
    const r = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + req.user.raw_token,
        'Accept':        'application/json'
      }
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(403).json({ error: 'Profile lookup failed', detail: 'HTTP ' + r.status + ': ' + body.slice(0, 200) });
    }
    const rows = await r.json();
    const p = Array.isArray(rows) ? rows[0] : null;
    if (p && p.title === 'ae') {
      return res.status(403).json({ error: 'Account executives cannot create clients' });
    }
    next();
  } catch (err) {
    return res.status(503).json({ error: 'AE check threw', detail: (err && err.message) || String(err) });
  }
}

// -------- Helper: send a proxied response to the frontend ------
async function proxyAndForward(res, path, opts) {
  try {
    const r = await callOUS(path, opts);
    // Mirror the OUS status code so the frontend can detect 404s
    // (e.g. "no records for that date") naturally.
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err && err.code === 'NOT_LOGGED_IN') {
      return res.status(503).json({ error: 'OUS proxy is not logged in yet' });
    }
    console.error('[ous-proxy] proxy error for ' + path + ':', err && err.message);
    res.status(502).json({ error: 'Upstream OUS request failed', detail: err && err.message });
  }
}

// =============================================================
// The three proxied endpoints the frontend calls.
// =============================================================

// GET /api/catalogos
//   No body; returns the upstream JSON verbatim.
app.get('/api/catalogos', requireSupabaseAuth, requireOnixAdmin, requireOUSLogin, (req, res) =>
  proxyAndForward(res, '/catalogos'));

// =============================================================
// Data endpoints
// Confirmed via Postman 2026-06-18:
//   GET /api/creditos-cierre-saldos  + body { fecha_cierre }
//   GET /api/creditos/por-vencer     + body { dias }
// Both are GET (not POST). We pass the parameters as both a JSON
// body AND a query string so OUS accepts whichever shape it wants.
// =============================================================

function buildQuery(params) {
  const usp = new URLSearchParams();
  Object.keys(params).forEach(k => {
    if (params[k] != null) usp.append(k, String(params[k]));
  });
  const s = usp.toString();
  return s ? '?' + s : '';
}

// GET /api/creditos-cierre-saldos — { fecha_cierre: 'YYYY-MM-DD' }
// OUS reads the param from the JSON body (confirmed via Postman).
// callOUS uses Node's raw http module for GET+body since fetch refuses.
// We also append it to the query string as a no-op safety net.
function creditosCierreSaldos(req, res) {
  const fecha_cierre = (req.body && req.body.fecha_cierre) || req.query.fecha_cierre;
  if (!fecha_cierre) {
    return res.status(400).json({ error: 'fecha_cierre is required' });
  }
  return proxyAndForward(
    res,
    '/creditos-cierre-saldos' + buildQuery({ fecha_cierre }),
    { method: 'GET', body: { fecha_cierre } }
  );
}
app.get('/api/creditos-cierre-saldos',  requireSupabaseAuth, requireOnixAdmin, requireOUSLogin, creditosCierreSaldos);
app.post('/api/creditos-cierre-saldos', requireSupabaseAuth, requireOnixAdmin, requireOUSLogin, creditosCierreSaldos);

// GET /api/creditos/por-vencer — { dias: <integer> }
function creditosPorVencer(req, res) {
  const diasRaw = (req.body && req.body.dias) != null ? req.body.dias : req.query.dias;
  const dias = Number(diasRaw);
  if (!Number.isFinite(dias) || dias < 0) {
    return res.status(400).json({ error: 'dias must be a non-negative integer' });
  }
  return proxyAndForward(
    res,
    '/creditos/por-vencer' + buildQuery({ dias }),
    { method: 'GET', body: { dias } }
  );
}
app.get('/api/creditos/por-vencer',  requireSupabaseAuth, requireOnixAdmin, requireOUSLogin, creditosPorVencer);
app.post('/api/creditos/por-vencer', requireSupabaseAuth, requireOnixAdmin, requireOUSLogin, creditosPorVencer);

// =============================================================
// OUS Pasiva -> Onix Supabase sync
//
// Runs on demand (admin clicks "Refresh from OUS") and on a schedule
// (pg_cron every 15 min hits POST /api/sync-run with X-Cron-Key).
//
// Data flow:
//   1. login to OUS (reuses existing loginToOUS + token loop)
//   2. fetch /creditos-cierre-saldos (rich, all active credits)
//      + /creditos/por-vencer (adds id_cliente, payment freq, renewal)
//   3. de-dupe clients by RFC. For each unique client:
//      - find existing profile by RFC
//      - if none, find by email (may be a manually-created account)
//      - if none, CREATE a placeholder auth.users + profiles row
//        (role='client', status='met' — visible in admin, no auth yet)
//   4. upsert every credit into loans by loan_id_display
//   5. write a summary row into ous_sync_log per endpoint
//
// Requires env vars:
//   SUPABASE_SERVICE_ROLE_KEY  — writes profiles / loans / auth users
//   SYNC_CRON_KEY              — optional, only needed for pg_cron path
// =============================================================

// -------- Small helpers --------------------------------------
function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
// Shared by both syncs — pure string parsing, no session/business state,
// so fixing it here benefits Pasiva too (it had the same silent gap) at
// zero risk to Pasiva's existing mes/dia/año branches (additive only).
// The semana/week branch was added for OUS Activa: confirmed via real
// sample data that some Activa credits use plazo values like
// "52 SEMANAS", which fell through to `null` before this fix.
function parseTermMonths(plazo) {
  if (!plazo) return null;
  const m = String(plazo).match(/(\d+)\s*(mes|meses|mo|month|d[íi]a|dia|dias|days|semana|semanas|week|weeks|a[ñn]os|year)/i);
  if (!m) return null;
  const n = Number(m[1]); if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('mes') || unit.startsWith('mo'))   return n;
  if (unit.startsWith('sem') || unit.startsWith('week')) return Math.round(n / 4.345);
  if (unit.startsWith('d')   || unit.startsWith('day'))  return Math.round(n / 30);
  if (unit.startsWith('a')   || unit.startsWith('y'))    return n * 12;
  return n;
}
function mapAccountingStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'operativa') return 'active';
  if (v === 'castigo')   return 'charged_off';
  return v || 'active';
}
function mapPaymentFrequency(t) {
  const v = String(t || '').toLowerCase();
  return {
    'diaria':      'daily',
    'semanal':     'weekly',
    'quincenal':   'biweekly',
    'mensual':     'monthly',
    'trimestral':  'quarterly',
    'anual':       'annual'
  }[v] || v || null;
}

// -------- Supabase service-role HTTP helpers -----------------
async function sbFetch(path, init) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase sync not configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  }
  const h = Object.assign({
    'apikey':        SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type':  'application/json',
    'Accept':        'application/json'
  }, (init && init.headers) || {});
  return fetch(SUPABASE_URL + path, Object.assign({}, init, { headers: h }));
}

// Find an existing profile by RFC, then by email, then by full_name.
// Returns { id } or null. Name match is case-insensitive and only used as
// a fallback because OUS Pasiva often ships credits without RFC/email.
async function findProfileByRfcOrEmailOrName(rfc, email, fullName) {
  if (rfc) {
    const r = await sbFetch('/rest/v1/profiles?rfc=eq.' + encodeURIComponent(rfc) + '&select=id&limit=1');
    if (r.ok) { const rows = await r.json(); if (rows && rows[0]) return rows[0]; }
  }
  if (email) {
    const r = await sbFetch('/rest/v1/profiles?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=id&limit=1');
    if (r.ok) { const rows = await r.json(); if (rows && rows[0]) return rows[0]; }
  }
  if (fullName) {
    // ilike is case- and whitespace-insensitive enough for our use here.
    const r = await sbFetch('/rest/v1/profiles?full_name=ilike.' + encodeURIComponent(fullName.trim()) + '&select=id&limit=1');
    if (r.ok) { const rows = await r.json(); if (rows && rows[0]) return rows[0]; }
  }
  return null;
}

// Finds an existing auth.users row by email, or creates a new one with a
// random pre-confirmed password. Pure Auth-API plumbing with no
// business-specific logic (no OUS field mapping, no profiles-table
// shape), so it's shared as-is between the Pasiva sync's
// createPlaceholderClient() below and the Activa admin action
// (createActivaAdminClient) — extracted verbatim from what was
// previously inlined here, not rewritten. Returns { userId, created }:
// created=false means an existing account was found and reused — callers
// must never delete a reused account on a later failure, only one they
// just created.
async function findOrCreateAuthUser(email, userMetadata) {
  // 1. Try to reuse an existing auth user with this email (rare but
  //    possible if the profile was deleted but auth.users survived).
  const lookup = await sbFetch('/auth/v1/admin/users?email=' + encodeURIComponent(email || ''));
  if (lookup.ok) {
    const body = await lookup.json();
    const list = (body && (body.users || (Array.isArray(body) ? body : []))) || [];
    if (list[0] && list[0].id) return { userId: list[0].id, created: false };
  }
  // 2. Otherwise create the auth user (random password, email confirmed
  //    so it's usable immediately if we later send a reset link).
  if (!email) return { userId: null, created: false };
  const rand = require('crypto').randomBytes(24).toString('base64url');
  const created = await sbFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email:        String(email).toLowerCase(),
      password:     rand,
      email_confirm: true,
      user_metadata: userMetadata || {}
    })
  });
  if (!created.ok) {
    const text = await created.text();
    throw new Error('auth.admin.createUser failed HTTP ' + created.status + ': ' + text.slice(0, 200));
  }
  const j = await created.json();
  const userId = j && (j.id || (j.user && j.user.id));
  if (!userId) throw new Error('createUser returned no id: ' + JSON.stringify(j).slice(0, 200));
  return { userId, created: true };
}

// Create a placeholder auth.users + linked profiles row. Returns id.
async function createPlaceholderClient({ email, full_name, rfc, regimen, promotor, bank_clabe, bank_account, ous_id_cliente }) {
  const { userId } = await findOrCreateAuthUser(email, { source: 'ous_sync', full_name: full_name || null });
  if (!userId) {
    // No email, and no existing account found → can't create auth user.
    // Skip this client (same behavior as before the extraction).
    return null;
  }
  // Insert the profile row. If a stray row already exists on this id
  // (from a previous partial sync), upsert instead of insert.
  const profile = {
    id: userId,
    email: (email || '').toLowerCase() || null,
    full_name: full_name || null,
    rfc: rfc || null,
    regimen: regimen || null,
    promotor: promotor || null,
    bank_clabe: bank_clabe || null,
    bank_account: bank_account || null,
    ous_id_cliente: ous_id_cliente || null,
    role: 'client',
    status: 'met'
  };
  const upserted = await sbFetch('/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(profile)
  });
  if (!upserted.ok) {
    const text = await upserted.text();
    throw new Error('profiles upsert (create path) failed HTTP ' + upserted.status + ': ' + text.slice(0, 200));
  }
  return userId;
}

// Update the profile with fresh OUS fields, only filling nulls so we
// don't stomp on manually-edited data.
async function fillProfileMissing(id, fields) {
  // Fetch the row so we can decide which fields to update.
  const r = await sbFetch('/rest/v1/profiles?id=eq.' + encodeURIComponent(id) +
    '&select=full_name,rfc,regimen,promotor,bank_clabe,bank_account,ous_id_cliente,email');
  if (!r.ok) return;
  const rows = await r.json();
  const cur = rows && rows[0]; if (!cur) return;
  const patch = {};
  ['full_name','rfc','regimen','promotor','bank_clabe','bank_account','ous_id_cliente'].forEach(k => {
    if ((cur[k] == null || cur[k] === '') && fields[k]) patch[k] = fields[k];
  });
  if (Object.keys(patch).length === 0) return;
  await sbFetch('/rest/v1/profiles?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch)
  });
}

// Upsert one loan by loan_id_display. Always takes OUS values.
async function upsertLoan(row) {
  const body = {
    loan_id_display:  row.loan_id_display,
    user_id:          row.user_id,
    product:          row.product || null,
    loan_type:        row.loan_type || null,
    term_months:      row.term_months,
    origination_date: row.origination_date || null,
    maturity_date:    row.maturity_date || null,
    principal_amount: row.principal_amount,
    interest_rate:    row.interest_rate,
    monthly_payment:  row.monthly_payment,
    balance:          row.balance,
    next_due_date:    row.next_due_date || null,
    status:           row.status || 'active',
    days_delinquent:  row.days_delinquent || 0,
    payment_frequency:row.payment_frequency || null,
    renewal_requested:!!row.renewal_requested,
    ous_synced_at:    new Date().toISOString()
  };
  const r = await sbFetch('/rest/v1/loans?on_conflict=loan_id_display', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('loans upsert failed HTTP ' + r.status + ': ' + text.slice(0, 200));
  }
}

// Write one row to ous_sync_log per endpoint.
async function logSync({ endpoint, rows_seen, clients_upserted, loans_upserted, clients_created, ok, error, duration_ms }) {
  await sbFetch('/rest/v1/ous_sync_log', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      endpoint, rows_seen, clients_upserted, loans_upserted,
      clients_created, ok, error, duration_ms
    })
  }).catch(() => {});
}

// -------- The sync itself ------------------------------------
async function runOUSSync() {
  const start = Date.now();

  // 1. Ensure OUS session
  if (!state.token) await tryLogin('sync-preflight');
  if (!state.token) throw new Error('OUS login unavailable — sync aborted');

  // 2. Fetch both credit endpoints
  const today = new Date().toISOString().slice(0, 10);
  const cs = await callOUS('/creditos-cierre-saldos' + buildQuery({ fecha_cierre: today }),
    { method: 'GET', body: { fecha_cierre: today } });
  const pv = await callOUS('/creditos/por-vencer' + buildQuery({ dias: 90 }),
    { method: 'GET', body: { dias: 90 } });
  // Same dias window as por-vencer above, for consistency. Unguarded like
  // the two calls above — a failure here aborts the sync same as they do,
  // rather than silently upserting loans with no next_due_date info.
  const pp = await callOUS('/creditos/proximo-pagos' + buildQuery({ dias: 90 }),
    { method: 'GET', body: { dias: 90 } });

  const csRows = (cs.body && cs.body.data) || [];
  const pvRows = (pv.body && pv.body.data) || [];
  const ppRows = (pp.body && pp.body.data) || [];
  if (!Array.isArray(csRows)) throw new Error('cierre-saldos returned non-array: ' + JSON.stringify(cs.body).slice(0, 200));

  // 3. Index por-vencer rows by id_credito for merge
  const pvByCredito = {};
  for (const r of pvRows) if (r && r.id_credito) pvByCredito[String(r.id_credito)] = r;

  // 3b. Group proximo-pagos rows by id_credito, keeping only the earliest
  //     due date — a credit can have several scheduled payment rows.
  //     fecha_vencimiento is used first because the name matches what
  //     next_due_date means ("vencimiento" = due); fecha_movimiento is a
  //     fallback for rows missing it. Not verified against a live payload
  //     which field OUS actually intends here.
  //     Deliberately NOT excluding dates before today: a still-active loan
  //     whose earliest scheduled date has already passed is delinquent, not
  //     "no next due date" — blanking it here hid overdue loans instead of
  //     just lacking future data. Only a missing date is skipped.
  const nextDueByCredito = {};
  for (const r of ppRows) {
    if (!r || !r.id_credito) continue;
    const d = r.fecha_vencimiento || r.fecha_movimiento || null;
    if (!d) continue;
    const key = String(r.id_credito);
    if (!nextDueByCredito[key] || d < nextDueByCredito[key]) nextDueByCredito[key] = d;
  }

  // 4. Group credits by client. Ideal key is RFC, but OUS often ships
  //    credits with blank RFC — fall back to email, then to name.
  //    Any credit without ANY identifier is dropped.
  const clientsByKey = new Map();
  for (const r of csRows) {
    const rfc      = (r.rfc || '').trim();
    const email    = (r.correo || '').toLowerCase().trim();
    const fullName = (r.nombre_cliente || '').trim();
    const key = rfc || email || fullName;
    if (!key) continue;
    if (!clientsByKey.has(key)) {
      const pvHit = pvByCredito[String(r.id_credito || '')];
      clientsByKey.set(key, {
        key,
        rfc:           rfc || null,
        email:         email || null,
        full_name:     fullName || null,
        regimen:       r.regimen || null,
        promotor:      r.promotor || null,
        bank_clabe:    r.clabe || null,
        bank_account:  r.cuenta || null,
        ous_id_cliente:(pvHit && pvHit.id_cliente) || null,
        credits: []
      });
    }
    clientsByKey.get(key).credits.push(r);
  }

  // 5. Per client: find or create → upsert their loans
  let clientsUpserted = 0, clientsCreated = 0, loansUpserted = 0, loansSkipped = 0;
  const errors = [];

  for (const [key, c] of clientsByKey.entries()) {
    let userId;
    try {
      const existing = await findProfileByRfcOrEmailOrName(c.rfc, c.email, c.full_name);
      if (existing) {
        userId = existing.id;
        await fillProfileMissing(userId, c);
      } else if (c.email) {
        // Only auto-create when we have an email (auth.users needs one).
        userId = await createPlaceholderClient(c);
        if (userId) clientsCreated++;
      } else {
        loansSkipped += c.credits.length;
        continue;
      }
      if (!userId) { loansSkipped += c.credits.length; continue; }
      clientsUpserted++;
    } catch (e) {
      errors.push('client ' + key + ': ' + (e.message || String(e)));
      continue;
    }

    for (const cr of c.credits) {
      try {
        const pvHit = pvByCredito[String(cr.id_credito || '')];
        await upsertLoan({
          loan_id_display:  String(cr.id_credito || '').trim() || null,
          user_id:          userId,
          product:          cr.producto || null,
          loan_type:        cr.tipo_credito || null,
          term_months:      parseTermMonths(cr.plazo),
          origination_date: cr.fecha_inicio || null,
          maturity_date:    cr.fecha_termino || null,
          principal_amount: toNum(cr.monto_otorgado),
          interest_rate:    toNum(cr.tasa_anualizada),
          monthly_payment:  toNum(cr.cuota),
          balance:          toNum(cr.saldo_total_capital),
          next_due_date:    nextDueByCredito[String(cr.id_credito || '')] || null,
          status:           mapAccountingStatus(cr.status_contable),
          days_delinquent:  toNum(cr.dias_mora) || 0,
          payment_frequency:mapPaymentFrequency(pvHit && pvHit.tipo_pago),
          renewal_requested:(pvHit && String(pvHit.tiene_solicitud_de_renovacion || '').toUpperCase() === 'SI')
        });
        loansUpserted++;
      } catch (e) {
        errors.push('loan ' + cr.id_credito + ': ' + (e.message || String(e)));
      }
    }
  }

  const summary = {
    ok: errors.length === 0,
    duration_ms: Date.now() - start,
    endpoints: ['/creditos-cierre-saldos', '/creditos/por-vencer'],
    rows_seen: csRows.length,
    clients_upserted: clientsUpserted,
    clients_created: clientsCreated,
    loans_upserted:  loansUpserted,
    loans_skipped:   loansSkipped,
    errors: errors.slice(0, 20)
  };

  await logSync({
    endpoint: '/creditos-cierre-saldos+por-vencer',
    rows_seen: csRows.length,
    clients_upserted: clientsUpserted,
    loans_upserted:   loansUpserted,
    clients_created:  clientsCreated,
    ok: summary.ok,
    error: errors.length ? errors.slice(0, 5).join(' | ') : null,
    duration_ms: summary.duration_ms
  });

  return summary;
}

// =============================================================
// OUS Activa -> Onix Supabase sync
//
// Deliberately a fully separate implementation from runOUSSync()
// above, not a shared/merged one — see PR description. Shares only
// genuinely stateless, generic helpers (sbFetch, buildQuery, toNum,
// parseTermMonths, mapPaymentFrequency, fillProfileMissing,
// rawHttpRequest) that carry no Pasiva-specific business logic or
// session state.
//
// Runs on demand (admin action) and on its own schedule (pg_cron
// hits POST /api/activa-sync-run with its own X-Cron-Key — see the
// accompanying SQL for ous_activa_sync_trigger() + the cron.job
// registration).
//
// Data flow, per the agreed design:
//   1. Resolve fecha_cierre from Activa's own /catalogos (falls back to
//      today's date, with a warning, only on an actual fetch failure or
//      response-shape surprise — data.fechaCierre is a real, documented
//      field, confirmed via the official OUS Activa API manual §3.6 and
//      a live Postman test, not inferred from Pasiva's shape).
//   2. Fetch /creditos-cierre-saldos (rich, all active credits) +
//      /creditos/por-vencer (adds producto, tipo_pago, renewal flag),
//      merged by id_credito — confirmed present for Activa via the
//      manual §3.3, same two-endpoint pattern as Pasiva.
//   3. Per credit: upsert the ous_activa_client_matches review-queue
//      row (id_credito, nombre_cliente_raw, last_seen_at ONLY — never
//      matched_profile_id/confidence/verified/verified_by/verified_at,
//      so an admin's prior review work can never be overwritten by a
//      sync run), then branch on its current verified state:
//        - verified = true  → upsert a real loans row
//          (data_source = 'ous_activa')
//        - verified = false → do NOT touch loans; if a loans row from
//          a PRIOR verified state still exists, flag it status='review'
//          rather than leaving it silently stale
//   4. Write one summary row to ous_activa_sync_log (a table fully
//      separate from Pasiva's ous_sync_log — see accompanying SQL).
//
// Idempotency: every write here is an upsert or a targeted, no-op-safe
// UPDATE — there are no deletes anywhere in this function. Running it
// twice in a row with unchanged upstream data produces byte-identical
// rows except for last_seen_at/ous_synced_at (which are *supposed* to
// advance every run — that's the "last synced" contract, not a
// idempotency violation). See PR description for the fuller argument.
//
// Requires env vars:
//   OUS_ACTIVA_LOGIN / OUS_ACTIVA_PASSWORD / OUS_ACTIVA_API_URL
//   SUPABASE_SERVICE_ROLE_KEY  (already required for Pasiva; reused —
//                                this is a Supabase-side credential,
//                                not an OUS one, so there's exactly one
//                                of these regardless of OUS source)
//   ACTIVA_SYNC_CRON_KEY       — optional, only needed for the pg_cron path
// =============================================================

// Maps loans.status for an Activa credit. Deliberately only ever
// returns one of the three values the CHECK constraint on loans.status
// actually allows ('active' | 'paid' | 'review'). Pasiva's own
// mapAccountingStatus() returns 'charged_off' for castigo status, which
// is NOT in that CHECK list — a live, latent bug there (any Pasiva
// credit hitting that branch fails its upsert silently, every sync,
// forever). Not fixed here (out of scope / a separate, Pasiva-only
// change) but deliberately not copied into this new code either.
function mapActivaStatus(fecha_castigo) {
  return fecha_castigo ? 'review' : 'active';
}

// Maps loans.loan_type for an Activa credit. OUS's own segmento field —
// meant to carry a real loan category — has been observed returning
// payment-description text instead ("Pagos fijos a lo largo del periodo",
// "Un sólo pago al final de periodo") for a small number of records; those
// leaked straight into the Dashboard's loan-type breakdown chart before
// this normalization existed. /catalogos would normally be the live source
// of truth for valid segmento values, but it's confirmed not to exist for
// this API (see the 404 note above), so there's no list to validate
// against — this hardcodes the only two values actually observed in real
// data instead of passing segmento through raw. Match is case-insensitive
// (OUS's real data is consistently uppercase today, but that's not
// guaranteed forever); anything that doesn't match, including null/empty,
// normalizes to 'Other' rather than leaking dirty text into the chart.
const ACTIVA_LOAN_TYPES = new Set(['SIMPLE', 'PERSONAL']);
function mapActivaLoanType(segmento) {
  const trimmed = String(segmento || '').trim();
  return ACTIVA_LOAN_TYPES.has(trimmed.toUpperCase()) ? trimmed : 'Other';
}

// Loose structural check for a real Mexican RFC, not a full checksum
// validator: 3-4 letters, then exactly 6 digits (the YYMMDD birthdate
// segment CLAUDE.md's notes call out), then 3 alphanumeric homoclave
// chars. This alone rejects the observed junk pattern ("HAAAAAAAAAAAA"
// — no digit run at all). The extra low-entropy guard is belt-and-
// suspenders against a pathological value that could still match the
// shape (e.g. a repeated-letter prefix landing next to a real-looking
// digit run by coincidence).
function isPlausibleRfc(raw) {
  if (!raw) return false;
  const rfc = String(raw).trim().toUpperCase();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return false;
  if (new Set(rfc).size < 3) return false;
  return rfc;
}

// Upserts the review-queue row for one credit. CRITICAL: only ever
// sends id_credito / nombre_cliente_raw / rfc / balance / interest_rate /
// last_seen_at — matched_profile_id, confidence, verified, verified_by,
// verified_at are deliberately never included in this payload, not even
// as null, so PostgREST's merge-duplicates upsert never touches them on
// an existing row. An admin's prior review work must survive every sync
// run untouched; only the sync-owned fields (name-as-last-seen, rfc,
// balance, interest_rate, last_seen_at) ever move. balance/interest_rate
// are what OUS itself reports for this credit — captured here (not just
// on the verified/written-loan path) so the review queue carries real
// figures for every credit, matched or not, which is what the
// Dashboard's pending-match total (see paintDashboardView/'Loan
// Portfolio') and the Calendar's pending-interest estimate read from
// directly. Uses
// return=representation to read back the row's current — possibly
// admin-set — review state in the same request, rather than a separate
// round-trip SELECT.
async function upsertActivaClientMatch(id_credito, nombre_cliente_raw, rfc, balance, interest_rate) {
  const r = await sbFetch('/rest/v1/ous_activa_client_matches?on_conflict=id_credito', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id_credito,
      nombre_cliente_raw,
      rfc: rfc || null,
      balance: balance != null ? toNum(balance) : null,
      interest_rate: interest_rate != null ? toNum(interest_rate) : null,
      last_seen_at: new Date().toISOString()
    })
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('ous_activa_client_matches upsert failed HTTP ' + r.status + ': ' + text.slice(0, 200));
  }
  const rows = await r.json();
  return rows[0];
}

// Suggests a match by exact RFC lookup against profiles.rfc — RFC is a
// unique government tax ID, so an exact single hit is treated as a
// high-confidence suggestion, not a guess. Deliberately does NOT set
// verified=true: it only pre-fills matched_profile_id + confidence so
// the existing Loan Match Review admin UI shows the client already
// picked, one click away from a real human confirming it (same as if
// an admin had searched and picked manually) — runOUSActivaSync()'s
// own verified-gate still decides whether a loan actually gets
// written. Never touches a row an admin has already worked on
// (matched and/or verified) — both the app-level check before calling
// this and the WHERE clause below guard that independently. A row with
// zero or multiple RFC hits is left alone rather than guessed at.
async function tryAutoMatchByRfc(matchRow, rawRfc) {
  if (matchRow.verified || matchRow.matched_profile_id) return matchRow;
  const rfc = isPlausibleRfc(rawRfc);
  if (!rfc) return matchRow;

  const lookup = await sbFetch('/rest/v1/profiles?rfc=eq.' + encodeURIComponent(rfc) + '&select=id&limit=2');
  if (!lookup.ok) return matchRow; // best-effort — never fail the sync over this
  const hits = await lookup.json();
  if (!hits || hits.length !== 1) return matchRow; // no match, or ambiguous — leave for manual review

  const patch = await sbFetch(
    '/rest/v1/ous_activa_client_matches?id_credito=eq.' + encodeURIComponent(matchRow.id_credito) +
    '&verified=eq.false&matched_profile_id=is.null',
    {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ matched_profile_id: hits[0].id, confidence: 'high' })
    }
  );
  if (!patch.ok) return matchRow; // best-effort here too
  const rows = await patch.json();
  return (rows && rows[0]) || matchRow;
}

// If a credit that is currently NOT verified has a live loans row from
// a PRIOR verified state (admin verified it, we wrote the loan, admin
// later un-verified the match — e.g. caught a mistake), flag that loan
// status='review' rather than silently leaving it looking untouched.
// Scoped to data_source='ous_activa' so this can never reach a Pasiva
// or manually-created loan (belt-and-suspenders: loan_id_display is
// already globally UNIQUE, so at most one row could ever match on that
// alone — the data_source filter just makes the intent unambiguous to
// a future reader). The status=neq.review filter just avoids a wasted
// no-op write when already flagged. Safe to call unconditionally — a
// non-match is simply zero rows patched, not an error.
async function flagUnverifiedActivaLoan(id_credito) {
  const r = await sbFetch(
    '/rest/v1/loans?loan_id_display=eq.' + encodeURIComponent(id_credito) +
    '&data_source=eq.ous_activa&status=neq.review',
    {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'review' })
    }
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error('flag-unverified-activa-loan failed HTTP ' + r.status + ': ' + text.slice(0, 200));
  }
}

// Upsert one Activa-sourced loan by loan_id_display (= id_credito) —
// same on_conflict + merge-duplicates idempotent pattern as Pasiva's
// upsertLoan(), targeting the same shared loans table, but always
// stamped data_source = 'ous_activa' and never called except from the
// verified=true branch below.
async function upsertActivaLoan(row) {
  const body = {
    loan_id_display:      row.id_credito,
    user_id:              row.user_id,
    data_source:          'ous_activa',
    balance:              toNum(row.balance),
    principal_amount:     toNum(row.principal_amount),
    interest_rate:        toNum(row.interest_rate),
    maturity_date:        row.maturity_date || null,
    origination_date:     row.origination_date || null,
    term_months:          row.term_months,
    days_delinquent:      row.days_delinquent || 0,
    loan_type:            row.loan_type || null,
    monthly_payment:      row.monthly_payment,
    // Payment aggregates from OUS cierre-saldos — used by the client
    // portal's Repayment Progress card so it can render real "X of Y
    // months paid" without needing per-payment loan_payments rows
    // (OUS Activa does not expose per-installment history).
    num_payments_made:    row.num_payments_made,
    num_payments_total:   row.num_payments_total,
    num_payments_overdue: row.num_payments_overdue,
    status:               row.status,
    product:              row.product || null,
    payment_frequency:    row.payment_frequency || null,
    renewal_requested:    !!row.renewal_requested,
    ous_synced_at:        new Date().toISOString()
  };
  const r = await sbFetch('/rest/v1/loans?on_conflict=loan_id_display', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('activa loans upsert failed HTTP ' + r.status + ': ' + text.slice(0, 200));
  }
}

// Writes one row per run to ous_activa_sync_log — see accompanying SQL
// for why this is a separate table from Pasiva's ous_sync_log rather
// than a shared one with a source column.
async function logActivaSync({ endpoint, rows_seen, clients_upserted, loans_upserted, clients_created, ok, error, duration_ms }) {
  await sbFetch('/rest/v1/ous_activa_sync_log', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      endpoint, rows_seen, clients_upserted, loans_upserted,
      clients_created, ok, error, duration_ms
    })
  }).catch(() => {});
}

async function runOUSActivaSync() {
  const start = Date.now();

  // 1. Ensure OUS Activa session (independent of Pasiva's — see
  //    stateActiva above). Lazy: this is the only place Activa login
  //    is ever attempted.
  if (!stateActiva.token) await tryLoginActiva('sync-preflight');
  if (!stateActiva.token) {
    throw new Error('OUS Activa login unavailable — sync aborted' +
      (stateActiva.lastError ? ': ' + stateActiva.lastError : ''));
  }

  // 2. Resolve fecha_cierre (+ a lookahead window for por-vencer) from
  //    Activa's own /catalogos. data.fechaCierre and data.rangoVencimiento
  //    Proximo (e.g. [30, 60, 90]) are documented real fields for Activa
  //    per the official API manual (§3.6) — but /catalogos itself has been
  //    CONFIRMED (live test, 2026-08-10) to return a genuine 404 "Endpoint
  //    no encontrado" for this API, contradicting the manual. This is not
  //    a defensive hedge against a rare network hiccup: the catch fallback
  //    below fires on every single sync run today, not an edge case. Also
  //    means /catalogos cannot be used as a live source of valid `segmento`
  //    categories for loan_type — see mapActivaLoanType() below, which
  //    hardcodes the known-good values instead.
  let fecha_cierre;
  let fechaCierreSource;
  let dias = 30;
  try {
    const cat = await callOUSActiva('/catalogos', { method: 'GET' });
    const d = cat.body && cat.body.data;
    if (d && d.fechaCierre) {
      fecha_cierre = d.fechaCierre;
      fechaCierreSource = 'catalogos';
    } else {
      fecha_cierre = new Date().toISOString().slice(0, 10);
      fechaCierreSource = 'fallback-missing-field';
      console.warn('[ous-activa-sync] /catalogos did not return data.fechaCierre (got: ' +
        JSON.stringify(cat.body).slice(0, 200) + ') — falling back to today\'s date: ' + fecha_cierre);
    }
    if (d && Array.isArray(d.rangoVencimientoProximo) && d.rangoVencimientoProximo.length) {
      dias = d.rangoVencimientoProximo[Math.floor(d.rangoVencimientoProximo.length / 2)];
    }
  } catch (err) {
    fecha_cierre = new Date().toISOString().slice(0, 10);
    fechaCierreSource = 'fallback-catalogos-error';
    if (!catalogosMissingWarned) {
      catalogosMissingWarned = true;
      console.warn('[ous-activa-sync] /catalogos is confirmed NOT to exist for OUS Activa ' +
        '(returns 404 despite being documented in the official manual) — every sync run falls ' +
        'back to today\'s date for fecha_cierre, and loan_type cannot be validated against a ' +
        'live catalog (see mapActivaLoanType). This is expected until OUS fixes or redocuments ' +
        'the endpoint; logged once per process so it stays visible without spamming every 15 min.');
    }
    console.warn('[ous-activa-sync] /catalogos fetch failed (' + ((err && err.message) || err) +
      ') — falling back to today\'s date: ' + fecha_cierre);
  }

  // 3. Fetch both credit endpoints. por-vencer is enrichment only
  //    (producto, tipo_pago, renewal flag) — if it fails, continue
  //    with cierre-saldos data alone rather than aborting the sync.
  const cs = await callOUSActiva('/creditos-cierre-saldos' + buildQuery({ fecha_cierre }),
    { method: 'GET', body: { fecha_cierre } });
  const csRows = (cs.body && cs.body.data) || [];
  if (!Array.isArray(csRows)) {
    throw new Error('Activa cierre-saldos returned non-array: ' + JSON.stringify(cs.body).slice(0, 200));
  }

  let pvRows = [];
  try {
    const pv = await callOUSActiva('/creditos/por-vencer' + buildQuery({ dias }),
      { method: 'GET', body: { dias } });
    pvRows = (pv.body && pv.body.data) || [];
  } catch (err) {
    console.warn('[ous-activa-sync] /creditos/por-vencer fetch failed (' +
      ((err && err.message) || err) + ') — continuing without producto/tipo_pago/renewal enrichment');
  }
  const pvByCredito = {};
  for (const r of pvRows) if (r && r.id_credito) pvByCredito[String(r.id_credito)] = r;

  // 4. Per credit: upsert the review-queue row, read back its current
  //    state, branch on verified.
  let matchesUpserted = 0, loansUpserted = 0, loansSkippedUnverified = 0, rfcAutoMatched = 0;
  const errors = [];

  for (const cr of csRows) {
    const id_credito = String(cr.id_credito || '').trim();
    if (!id_credito) continue;
    const nombre_cliente_raw = String(cr.nombre_cliente || '').trim();

    let matchRow;
    try {
      matchRow = await upsertActivaClientMatch(id_credito, nombre_cliente_raw, cr.rfc, cr.saldo_total_vigente, cr.tasa);
      matchesUpserted++;
    } catch (e) {
      errors.push('match-upsert ' + id_credito + ': ' + (e.message || String(e)));
      continue;
    }

    try {
      const beforeMatch = matchRow.matched_profile_id;
      matchRow = await tryAutoMatchByRfc(matchRow, cr.rfc);
      if (!beforeMatch && matchRow.matched_profile_id) rfcAutoMatched++;
    } catch (e) {
      errors.push('rfc-auto-match ' + id_credito + ': ' + (e.message || String(e)));
    }

    if (!matchRow.verified || !matchRow.matched_profile_id) {
      loansSkippedUnverified++;
      try {
        await flagUnverifiedActivaLoan(id_credito);
      } catch (e) {
        errors.push('unverify-flag ' + id_credito + ': ' + (e.message || String(e)));
      }
      continue;
    }

    const pvHit = pvByCredito[id_credito];
    const numCuotas = toNum(cr.num_cuotas_contratadas);
    try {
      await upsertActivaLoan({
        id_credito,
        user_id:              matchRow.matched_profile_id,
        balance:               cr.saldo_total_vigente,
        principal_amount:      cr.capital,
        interest_rate:         cr.tasa,
        maturity_date:          cr.fecha_termino || null,
        origination_date:       cr.fecha_inicio || null,
        term_months:            parseTermMonths(cr.plazo),
        days_delinquent:        toNum(cr.dias_mora) || 0,
        loan_type:              mapActivaLoanType(cr.segmento),
        // Only a real "monthly payment" for multi-installment loans —
        // for single-installment/bullet credits (num_cuotas_contratadas
        // == 1, common in this data) monto_cuota_por_devengar is the
        // full payoff amount, not a recurring monthly figure.
        monthly_payment:        (numCuotas != null && numCuotas > 1) ? toNum(cr.monto_cuota_por_devengar) : null,
        // Real payment counts direct from OUS — the client portal reads
        // these into the "Paid — X of Y months" line instead of counting
        // loan_payments rows (which don't get populated for OUS-sourced
        // loans).
        num_payments_made:      toNum(cr.num_cuotas_pagadas),
        num_payments_total:     toNum(cr.num_cuotas_contratadas),
        num_payments_overdue:   toNum(cr.num_cuotas_vencidas),
        status:                mapActivaStatus(cr.fecha_castigo),
        product:               (pvHit && pvHit.producto) || null,
        payment_frequency:     mapPaymentFrequency(pvHit && pvHit.tipo_pago),
        renewal_requested:     !!(pvHit && String(pvHit.tiene_solicitud_de_renovacion || '').toUpperCase() === 'SI')
      });
      loansUpserted++;

      // promotor is a client-level (profiles) field, not a loan-level
      // one — same distinction as Pasiva's placeholder-client creation.
      // fillProfileMissing only fills currently-blank fields, so this
      // can never clobber a manually-edited profile.
      if (cr.promotor && cr.promotor !== 'SIN PROMOTOR') {
        await fillProfileMissing(matchRow.matched_profile_id, { promotor: cr.promotor });
      }
    } catch (e) {
      errors.push('loan-upsert ' + id_credito + ': ' + (e.message || String(e)));
    }
  }

  const summary = {
    ok: errors.length === 0,
    duration_ms: Date.now() - start,
    fecha_cierre, fecha_cierre_source: fechaCierreSource, dias,
    credits_seen: csRows.length,
    matches_upserted: matchesUpserted,
    rfc_auto_matched: rfcAutoMatched,
    loans_upserted: loansUpserted,
    loans_skipped_unverified: loansSkippedUnverified,
    errors: errors.slice(0, 20)
  };

  await logActivaSync({
    endpoint: 'activa/creditos-cierre-saldos+por-vencer',
    rows_seen: csRows.length,
    clients_upserted: matchesUpserted,
    loans_upserted: loansUpserted,
    clients_created: 0,
    ok: summary.ok,
    error: errors.length ? errors.slice(0, 5).join(' | ') : null,
    duration_ms: summary.duration_ms
  });

  return summary;
}

// -------- Auth: admin JWT OR X-Cron-Key ----------------------
async function requireAdminOrCronKey(req, res, next) {
  const key = req.headers['x-cron-key'];
  if (SYNC_CRON_KEY && key && key === SYNC_CRON_KEY) return next();
  // Fall through to normal admin gate (JWT via requireSupabaseAuth + requireOnixAdmin)
  return requireSupabaseAuth(req, res, () => requireOnixAdmin(req, res, next));
}

// -------- Routes ---------------------------------------------
// POST /api/sync-run — runs the sync now. Returns summary.
app.post('/api/sync-run', requireAdminOrCronKey, requireOUSLogin, async (req, res) => {
  try {
    const summary = await runOUSSync();
    return res.json(summary);
  } catch (err) {
    console.error('[ous-sync] failed:', err && err.message);
    // Also log the failure so the "last synced" chip shows it.
    await logSync({
      endpoint: '/creditos-cierre-saldos+por-vencer',
      ok: false,
      error: (err && err.message) || String(err),
      duration_ms: 0
    });
    return res.status(500).json({ ok: false, error: (err && err.message) || String(err) });
  }
});

// GET /api/sync-status — small pass-through so the admin portal doesn't
// have to hit Supabase separately. Reads the latest ous_sync_log row.
app.get('/api/sync-status', requireSupabaseAuth, requireOnixAdmin, async (req, res) => {
  try {
    const r = await sbFetch('/rest/v1/ous_sync_log?select=ran_at,ok,rows_seen,clients_upserted,loans_upserted,clients_created,error,duration_ms&order=ran_at.desc&limit=1');
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: 'sync_status failed', detail: text.slice(0, 200) });
    }
    const rows = await r.json();
    return res.json({ latest: (rows && rows[0]) || null });
  } catch (err) {
    return res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

// -------- Auth: admin JWT OR X-Cron-Key, Activa's own key ----
// Deliberately a separate secret from SYNC_CRON_KEY (ACTIVA_SYNC_
// CRON_KEY) — a leaked key only ever exposes one of the two sync
// routes, not both. Falls through to the same admin-JWT gate as
// Pasiva's requireAdminOrCronKey — that part genuinely is generic
// (just "is this caller an Onix admin"), not Pasiva-specific.
async function requireAdminOrActivaCronKey(req, res, next) {
  const key = req.headers['x-cron-key'];
  if (ACTIVA_SYNC_CRON_KEY && key && key === ACTIVA_SYNC_CRON_KEY) return next();
  return requireSupabaseAuth(req, res, () => requireOnixAdmin(req, res, next));
}

// POST /api/activa-sync-run — runs the OUS Activa sync now. Returns
// summary. No requireOUSLogin-equivalent gate here (unlike Pasiva's
// route) — Activa's session is lazy/on-demand inside
// runOUSActivaSync() itself (see stateActiva above), so there's
// nothing meaningful to pre-check; the function reports a clear
// "not configured" / "login unavailable" error on its own instead.
app.post('/api/activa-sync-run', requireAdminOrActivaCronKey, async (req, res) => {
  try {
    const summary = await runOUSActivaSync();
    return res.json(summary);
  } catch (err) {
    console.error('[ous-activa-sync] failed:', err && err.message);
    await logActivaSync({
      endpoint: 'activa/creditos-cierre-saldos+por-vencer',
      ok: false,
      error: (err && err.message) || String(err),
      duration_ms: 0
    });
    return res.status(500).json({ ok: false, error: (err && err.message) || String(err) });
  }
});

// -------- Activa admin: create a new client + link it to a credit ------
// Deliberate manual admin action from the Loan Match Review tab, distinct
// from the automatic OUS Pasiva sync's createPlaceholderClient() above —
// reuses only the stateless findOrCreateAuthUser() plumbing, not any of
// the sync-specific field mapping or the 'ous_sync' metadata tag.
//
// profiles + ous_activa_client_matches are written atomically together
// via the activa_admin_create_client() Postgres function (see
// accompanying SQL) — if the match row was already claimed by a
// concurrent request, that function raises and the whole transaction
// (including the profile insert) rolls back. auth.users creation can't
// share that transaction (different system, Admin Auth API) — if the
// RPC fails after we created a *fresh* auth user (not a reused one), we
// delete it so a retry with the same email doesn't hit "already exists."
async function createActivaAdminClient({ id_credito, full_name, email, phone, address, adminId }) {
  const existing = await sbFetch('/rest/v1/ous_activa_client_matches?id_credito=eq.' +
    encodeURIComponent(id_credito) + '&select=id_credito,verified,matched_profile_id');
  if (!existing.ok) {
    const text = await existing.text();
    throw new Error('match lookup failed HTTP ' + existing.status + ': ' + text.slice(0, 200));
  }
  const existingRows = await existing.json();
  const matchRow = existingRows && existingRows[0];
  if (!matchRow) {
    const err = new Error('No ous_activa_client_matches row for id_credito ' + id_credito);
    err.status = 404;
    throw err;
  }
  if (matchRow.verified && matchRow.matched_profile_id) {
    const err = new Error('This credit is already matched and verified.');
    err.status = 409;
    throw err;
  }

  const { userId, created } = await findOrCreateAuthUser(email, {
    source: 'ous_activa_admin_created',
    full_name: full_name || null,
    created_by_admin_id: adminId,
    id_credito
  });
  if (!userId) {
    const err = new Error('Could not create or find an account for that email.');
    err.status = 400;
    throw err;
  }

  const rpcRes = await sbFetch('/rest/v1/rpc/activa_admin_create_client', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id:    userId,
      p_email:      String(email).trim().toLowerCase(),
      p_full_name:  String(full_name).trim(),
      p_phone:      phone   ? String(phone).trim()   : null,
      p_address:    address ? String(address).trim() : null,
      p_id_credito: id_credito,
      p_admin_id:   adminId
    })
  });
  if (!rpcRes.ok) {
    const text = await rpcRes.text();
    // Only clean up an auth user we just created this call — never touch
    // one that was found and reused (it predates this request).
    if (created) {
      await sbFetch('/auth/v1/admin/users/' + encodeURIComponent(userId), { method: 'DELETE' }).catch(() => {});
    }
    throw new Error('activa_admin_create_client failed HTTP ' + rpcRes.status + ': ' + text.slice(0, 300));
  }
  const rpcBody = await rpcRes.json();
  const match = Array.isArray(rpcBody) ? rpcBody[0] : rpcBody;
  return { profileId: userId, linkedExistingAccount: !created, match };
}

// POST /api/activa-create-client — admin-only, never a cron path (no
// requireAdminOrActivaCronKey here on purpose: this must always be a
// real human admin, never automated).
app.post('/api/activa-create-client', requireSupabaseAuth, requireOnixAdmin, requireNotAE, async (req, res) => {
  const body = req.body || {};
  const id_credito = body.id_credito;
  const full_name  = (body.full_name || '').trim();
  const email      = (body.email || '').trim();
  const phone      = body.phone;
  const address    = body.address;

  if (!id_credito || !String(id_credito).trim()) {
    return res.status(400).json({ ok: false, error: 'id_credito is required' });
  }
  if (!full_name) {
    return res.status(400).json({ ok: false, error: 'full_name is required' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'A valid email is required' });
  }

  try {
    const result = await createActivaAdminClient({
      id_credito, full_name, email, phone, address, adminId: req.user.id
    });
    return res.json({
      ok: true,
      profile_id: result.profileId,
      linked_existing_account: result.linkedExistingAccount,
      match: result.match
    });
  } catch (err) {
    console.error('[activa-create-client] failed:', err && err.message);
    return res.status(err.status || 500).json({ ok: false, error: (err && err.message) || String(err) });
  }
});

// =============================================================
// OUS payload capture — one-off diagnostic for setting up sync
//
// Fires all three OUS endpoints in one shot and writes the raw
// JSON payloads into the public.ous_raw_capture table so a
// developer can inspect the field shapes via SQL and build the
// OUS→Onix field mapping. Safe to leave in production — it just
// stages data, doesn't modify anything else.
//
//   POST /api/ous-capture
//   Body: { fecha_cierre?: 'YYYY-MM-DD', dias?: number }
//   Auth: authenticated admin (any staff role)
// =============================================================
async function insertCapture(userJwt, endpoint, params, httpStatus, payload, errorMsg) {
  if (!SUPABASE_URL) return { ok: false, error: 'SUPABASE_URL missing' };
  const row = {
    endpoint,
    params: params || null,
    http_status: httpStatus,
    payload: payload || null,
    error: errorMsg || null
  };
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/ous_raw_capture', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + userJwt,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: 'HTTP ' + r.status + ': ' + text.slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function captureOne(userJwt, endpoint, ousPath, callOpts, params) {
  try {
    const r = await callOUS(ousPath, callOpts || {});
    const write = await insertCapture(userJwt, endpoint, params, r.status, r.body, null);
    return { endpoint, http_status: r.status, saved: write.ok, save_error: write.error };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    const write = await insertCapture(userJwt, endpoint, params, null, null, msg);
    return { endpoint, error: msg, saved: write.ok, save_error: write.error };
  }
}

app.post(
  '/api/ous-capture',
  requireSupabaseAuth, requireOnixAdmin, requireOUSLogin,
  async (req, res) => {
    const fecha_cierre = (req.body && req.body.fecha_cierre) || new Date().toISOString().slice(0, 10);
    const diasRaw     = (req.body && req.body.dias);
    const dias        = Number.isFinite(Number(diasRaw)) ? Number(diasRaw) : 90;
    const jwt         = req.user && req.user.raw_token;
    if (!jwt) return res.status(401).json({ error: 'Missing JWT for staging write' });

    const results = await Promise.all([
      captureOne(jwt, '/catalogos', '/catalogos', { method: 'GET' }, {}),
      captureOne(
        jwt, '/creditos-cierre-saldos',
        '/creditos-cierre-saldos' + buildQuery({ fecha_cierre }),
        { method: 'GET', body: { fecha_cierre } },
        { fecha_cierre }
      ),
      captureOne(
        jwt, '/creditos/por-vencer',
        '/creditos/por-vencer' + buildQuery({ dias }),
        { method: 'GET', body: { dias } },
        { dias }
      )
    ]);

    res.json({ ok: true, params: { fecha_cierre, dias }, results });
  }
);

// 404 for anything else under /api to make typos obvious in the
// browser DevTools network tab.
app.use('/api', (req, res) =>
  res.status(404).json({ error: 'Unknown OUS proxy endpoint: ' + req.method + ' ' + req.path }));

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------

app.listen(PORT, () => {
  console.log('[ous-proxy] listening on :' + PORT);
  console.log('[ous-proxy] OUS_API_URL=' + (OUS_API_URL || '(unset)'));
  console.log('[ous-proxy] allowed origins=' + ALLOWED_ORIGINS.join(', '));
  // OUS Activa has no boot-time login (see stateActiva above) — just
  // log whether it's configured at all, so a misconfigured deploy is
  // visible in the Railway log tail without needing to hit the route.
  console.log('[ous-proxy] OUS_ACTIVA_API_URL=' + (OUS_ACTIVA_API_URL || '(unset — /api/activa-sync-run will fail until set)'));
  // Kick off the auth loop after the HTTP listener is up so /healthz
  // is reachable while we're still fetching the first token.
  startAuthLoop().catch(err =>
    console.error('[ous-proxy] startAuthLoop crashed unexpectedly:', err));
});

// ---------------------------------------------------------------
// Notes you'll want once this is in production
// ---------------------------------------------------------------
//
// 1. SECURITY — this server's CORS allowlist blocks browsers from
//    other origins, but anyone who finds the Railway URL can still
//    hit it from curl or Postman. If the OUS data is sensitive,
//    add a Supabase admin-JWT check before requireOUSLogin: verify
//    the Bearer token in the incoming Authorization header against
//    Supabase's JWKS (https://<project>.supabase.co/auth/v1/keys)
//    and reject anything where app_metadata.role !== 'admin'.
//    Doing this purely with node-fetch + a small jose import would
//    keep the dependency footprint tiny.
//
// 2. WHEN THE OUS DOCS LAND — re-read loginToOUS() above. If the
//    login path or body shape is different, update only the three
//    lines marked "ADJUST". Everything else (refresh timer, 401
//    re-login, CORS, etc.) stays the same.
//
// 3. RAILWAY DEPLOY CHECKLIST —
//      - Add OUS_LOGIN, OUS_PASSWORD, OUS_API_URL under Variables
//      - Railway auto-detects `npm start` from package.json
//      - Confirm the public URL responds at /healthz
//      - Add the URL to ALLOWED_ORIGINS' counterpart in the
//        frontend fetch call (or set ALLOWED_ORIGINS to include
//        any other domain you need)
