import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // --- Verify the caller is an authenticated admin ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt)
    return new Response(JSON.stringify({ error: "Missing auth" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user)
    return new Response(JSON.stringify({ error: "Invalid session" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  const { data: callerProfile } = await adminClient
    .from("profiles").select("role").eq("id", userData.user.id).single();
  if (!callerProfile || callerProfile.role !== "admin")
    return new Response(JSON.stringify({ error: "Admins only" }),
      { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  let payload: { full_name?: string; email?: string };
  try { payload = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("LOAN_APP_FROM_EMAIL") ?? "Onix Portal <onboarding@resend.dev>";
  if (!RESEND_API_KEY)
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  const { full_name = "", email = "" } = payload;
  if (!email)
    return new Response(JSON.stringify({ error: "email is required" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  // Same base URL setting as invite-team-member / send-client-activation,
  // so a domain change is one secret instead of a code edit per function.
  const PORTAL_BASE = (Deno.env.get("PORTAL_BASE_URL") ?? "https://onix-red.vercel.app").replace(/\/$/, "");
  const portalUrl = `${PORTAL_BASE}/login`;
  const subject = `Your Onix Finance account is active`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A">
      <div style="background:#1A1A1A;color:#fff;padding:24px 28px">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:700">Onix Finance Portal</div>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-weight:500;font-size:28px;margin:6px 0 0">Welcome to Onix Finance</h1>
      </div>
      <div style="border:1px solid #E8E8E8;border-top:none;padding:28px;line-height:1.6;font-size:14px">
        <p>${full_name ? `Dear ${esc(full_name)},` : "Hello,"}</p>
        <p>Your Onix Finance account has been approved. You can now sign in to view your portfolio, manage your loans, and explore current investment opportunities.</p>
        <p style="text-align:center;margin:32px 0">
          <a href="${portalUrl}" style="display:inline-block;background:#C0392B;color:#fff;padding:14px 28px;text-decoration:none;font-weight:600;letter-spacing:.05em;text-transform:uppercase;font-size:13px;border-radius:2px">Sign in to the portal</a>
        </p>
        <p style="font-size:13px;color:#888">If the button doesn't work, copy this link into your browser:<br><a href="${portalUrl}" style="color:#C0392B">${portalUrl}</a></p>
        <p>For questions, contact us at info@onixfinance.com.</p>
        <p style="margin-top:24px">Best regards,<br>The Onix Finance Team</p>
      </div>
      <div style="text-align:center;padding:16px;font-size:11px;color:#888">Onix Finance, LLC · Houston, TX · Private &amp; Confidential</div>
    </div>`;

  const text =
    `${full_name ? `Dear ${full_name},\n\n` : "Hello,\n\n"}` +
    `Your Onix Finance account has been approved. You can now sign in.\n\n` +
    `${portalUrl}\n\n` +
    `For questions, contact us at info@onixfinance.com.\n\n` +
    `Best regards,\nThe Onix Finance Team`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html, text }),
  });
  const resendBody = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok)
    return new Response(JSON.stringify({ error: "Resend API error", detail: resendBody }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ ok: true, id: resendBody.id, to: email }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
});
