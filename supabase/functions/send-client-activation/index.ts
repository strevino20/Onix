import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Emails existing client accounts a one-time, 7-day link to set their
// password (activate.html -> activate-client-account). Callable by any
// active staff member (admin, AE, manager). Body: { profile_ids: [...] },
// at most 25 per call; sends are paced to stay under Resend's rate limit.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MAX_PER_CALL = 25;
const SEND_GAP_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const COPY = {
  en: {
    subject: "Activate your Onix Finance account",
    heading: "Activate your account",
    greet: (n: string) => (n ? `Dear ${esc(n)},` : "Hello,"),
    body: "Your Onix Finance client portal is ready. Set your password to view your loans, deposits, and documents online.",
    button: "Set my password",
    alt: "If the button doesn't work, copy this link into your browser:",
    expiry: "This link expires in 7 days and can only be used once. If it expires, contact us and we'll send a new one.",
    ignore: "If you weren't expecting this email, you can ignore it.",
    sign: "Best regards,<br>The Onix Finance Team",
  },
  es: {
    subject: "Active su cuenta de Onix Finance",
    heading: "Active su cuenta",
    greet: (n: string) => (n ? `Estimado(a) ${esc(n)}:` : "Hola:"),
    body: "Su portal de cliente de Onix Finance está listo. Establezca su contraseña para consultar en línea sus préstamos, depósitos y documentos.",
    button: "Establecer mi contraseña",
    alt: "Si el botón no funciona, copie este enlace en su navegador:",
    expiry: "Este enlace vence en 7 días y solo puede usarse una vez. Si vence, contáctenos y le enviaremos uno nuevo.",
    ignore: "Si no esperaba este correo, puede ignorarlo.",
    sign: "Saludos cordiales,<br>El equipo de Onix Finance",
  },
};

function buildEmail(fullName: string, lang: "en" | "es", link: string) {
  const order: ("en" | "es")[] = lang === "es" ? ["es", "en"] : ["en", "es"];
  const block = (l: "en" | "es") => {
    const c = COPY[l];
    return `
        <p style="margin:0 0 16px">${c.greet(fullName)}</p>
        <p style="margin:0 0 16px">${c.body}</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${esc(link)}" style="display:inline-block;background:#C0392B;color:#fff;padding:14px 28px;text-decoration:none;font-weight:600;letter-spacing:.05em;text-transform:uppercase;font-size:13px;border-radius:2px">${c.button}</a>
        </p>
        <p style="margin:0 0 6px;font-size:12px;color:#888">${c.alt}</p>
        <p style="margin:0 0 16px;font-size:12px;color:#C0392B;word-break:break-all">${esc(link)}</p>
        <p style="margin:0 0 8px;font-size:12px;color:#888">${c.expiry}</p>
        <p style="margin:0 0 16px;font-size:12px;color:#888">${c.ignore}</p>
        <p style="margin:16px 0 0">${c.sign}</p>`;
  };
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A">
      <div style="background:#1A1A1A;color:#fff;padding:24px 28px">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:700">Onix Finance</div>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-weight:500;font-size:28px;margin:6px 0 0">${COPY[order[0]].heading}</h1>
      </div>
      <div style="border:1px solid #E8E8E8;border-top:none;padding:28px;line-height:1.6;font-size:14px">
        ${block(order[0])}
        <hr style="border:none;border-top:1px solid #E8E8E8;margin:28px 0">
        ${block(order[1])}
      </div>
      <div style="text-align:center;padding:16px;font-size:11px;color:#888">Onix Finance, LLC · Houston, TX · Private &amp; Confidential</div>
    </div>`;
  const textBlock = (l: "en" | "es") => {
    const c = COPY[l];
    const strip = (s: string) => s.replace(/<br>/g, "\n").replace(/&amp;/g, "&");
    return `${strip(c.greet(fullName))}\n\n${c.body}\n\n${link}\n\n${c.expiry}\n${c.ignore}\n\n${strip(c.sign)}`;
  };
  const text = `${textBlock(order[0])}\n\n----------\n\n${textBlock(order[1])}`;
  return { subject: `${COPY[order[0]].subject} / ${COPY[order[1]].subject}`, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL   = Deno.env.get("CLIENT_INVITE_FROM_EMAIL");
  const REPLY_TO     = Deno.env.get("CLIENT_INVITE_REPLY_TO");
  const PORTAL_BASE  = (Deno.env.get("PORTAL_BASE_URL") ?? "https://onix-red.vercel.app").replace(/\/$/, "");

  // --- Verify the caller is active staff (admin, AE, or manager) ---
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing auth" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
  const callerId = userData.user.id;
  const { data: caller } = await admin
    .from("profiles").select("role, status").eq("id", callerId).single();
  if (!caller || !["admin", "manager"].includes(caller.role) || caller.status !== "active")
    return json({ error: "Staff only" }, 403);

  // Refuse to mint links we can't deliver: Resend's default sender only
  // reaches the Resend account owner, so a missing sender is a config error.
  if (!RESEND_KEY) return json({ error: "RESEND_API_KEY is not configured" }, 500);
  if (!FROM_EMAIL) return json({ error: "CLIENT_INVITE_FROM_EMAIL is not configured" }, 500);

  // --- Parse input ---
  let body: { profile_ids?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const ids = Array.isArray(body.profile_ids)
    ? [...new Set(body.profile_ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (!ids.length) return json({ error: "profile_ids is required" }, 400);
  if (ids.length > MAX_PER_CALL) return json({ error: `At most ${MAX_PER_CALL} clients per request` }, 400);

  const { data: profiles, error: profErr } = await admin
    .from("profiles").select("id, full_name, email, role, status, preferred_language").in("id", ids);
  if (profErr) return json({ error: "Lookup failed" }, 500);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const results: Record<string, unknown>[] = [];
  let sentAny = false;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || p.role !== "client") { results.push({ profile_id: id, ok: false, reason: "not_a_client" }); continue; }
    if (!["active", "met"].includes(p.status)) { results.push({ profile_id: id, ok: false, reason: "status_" + p.status }); continue; }
    const email = String(p.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { results.push({ profile_id: id, ok: false, reason: "no_email" }); continue; }

    // Revoke any live link, then create the new one.
    await admin.from("client_activations").update({ status: "revoked" })
      .eq("profile_id", id).eq("status", "pending");
    const token = newToken();
    const { data: row, error: insErr } = await admin.from("client_activations").insert({
      profile_id: id, email, token_hash: await sha256Hex(token), sent_by: callerId,
    }).select("id").single();
    if (insErr || !row) { results.push({ profile_id: id, ok: false, reason: "insert_failed" }); continue; }

    const lang = p.preferred_language === "es" ? "es" : "en";
    const link = `${PORTAL_BASE}/activate?token=${encodeURIComponent(token)}&lang=${lang}`;
    const { subject, html, text } = buildEmail(String(p.full_name ?? "").trim(), lang, link);

    if (sentAny) await sleep(SEND_GAP_MS);
    sentAny = true;
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL, to: [email], subject, html, text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      }),
    });
    const resendBody = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      // Don't leave a live link behind for an email that never went out.
      await admin.from("client_activations").update({ status: "revoked" }).eq("id", row.id);
      results.push({ profile_id: id, ok: false, reason: "email_failed", detail: resendBody?.message ?? resendRes.status });
      continue;
    }
    await admin.from("client_activations").update({ email_id: resendBody.id ?? null }).eq("id", row.id);
    results.push({ profile_id: id, ok: true, email });
  }

  return json({ ok: true, sent: results.filter((r) => r.ok).length, results });
});
