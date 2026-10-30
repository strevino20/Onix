import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TITLE_LABEL: Record<string, string> = {
  admin: "Admin", manager: "Manager", ae: "Account Executive",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL   = Deno.env.get("TEAM_INVITE_FROM_EMAIL") ?? "Onix Finance <onboarding@resend.dev>";
  const PORTAL_BASE  = (Deno.env.get("PORTAL_BASE_URL") ?? "https://onix-red.vercel.app").replace(/\/$/, "");

  // --- Verify the caller is an authenticated admin ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing auth" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
  const callerId = userData.user.id;
  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", callerId).single();
  if (!callerProfile || callerProfile.role !== "admin")
    return json({ error: "Admins only" }, 403);

  // --- Parse input ---
  let body: { email?: string; full_name?: string; title?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  const full_name = (body.full_name ?? "").trim();
  const title = ["admin", "manager", "ae"].includes(body.title ?? "") ? body.title! : "admin";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "Valid email required" }, 400);

  // --- Already a member / already invited? ---
  const { data: existingProfile } = await admin
    .from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (existingProfile && existingProfile.role === "admin")
    return json({ error: "That email is already an Onix team member." }, 409);

  // Revoke any prior pending invite for this email, then create a fresh one
  await admin.from("team_invites").update({ status: "revoked" })
    .eq("email", email).eq("status", "pending");

  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const { error: insErr } = await admin.from("team_invites").insert({
    email, full_name: full_name || null, title, token, invited_by: callerId,
  });
  if (insErr) return json({ error: "Could not create invite: " + insErr.message }, 500);

  // --- Send the invite email via Resend ---
  const acceptUrl = `${PORTAL_BASE}/accept-invite.html?token=${encodeURIComponent(token)}`;
  if (!RESEND_KEY) return json({ ok: true, emailed: false, acceptUrl, note: "RESEND_API_KEY not set" });

  const roleLabel = TITLE_LABEL[title] || "Team Member";
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
      <div style="background:#1A1A1A;color:#fff;padding:24px 28px">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:700">Onix Finance</div>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-weight:500;font-size:26px;margin:6px 0 0">You're invited to the team</h1>
      </div>
      <div style="border:1px solid #E8E8E8;border-top:none;padding:28px;line-height:1.6;font-size:14px">
        <p style="margin:0 0 16px">${full_name ? "Hi " + esc(full_name) + "," : "Hello,"}</p>
        <p style="margin:0 0 16px">You've been invited to join the Onix Finance admin portal as <strong>${esc(roleLabel)}</strong>. Click below to set your password and activate your account.</p>
        <p style="margin:24px 0"><a href="${esc(acceptUrl)}" style="display:inline-block;background:#C0392B;color:#fff;text-decoration:none;padding:13px 22px;font-weight:600;font-size:13px;letter-spacing:.04em;border-radius:2px">Accept Invitation &rarr;</a></p>
        <p style="margin:0 0 8px;font-size:12px;color:#888">Or paste this link into your browser:</p>
        <p style="margin:0 0 16px;font-size:12px;color:#C0392B;word-break:break-all">${esc(acceptUrl)}</p>
        <p style="margin:16px 0 0;font-size:12px;color:#888">This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
      </div>
    </div>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to: [email],
      subject: "You're invited to the Onix Finance team",
      html,
      text: `You've been invited to join the Onix Finance admin portal as ${roleLabel}.\n\nSet your password and activate your account:\n${acceptUrl}\n\nThis invitation expires in 7 days.`,
    }),
  });
  const resendBody = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok)
    return json({ ok: true, emailed: false, acceptUrl, resendError: resendBody });

  return json({ ok: true, emailed: true, acceptUrl, id: resendBody.id });
});
