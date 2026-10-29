import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backs activate.html. The link's token is the only credential:
//   GET  ?token=...                 -> is the link usable? (name + masked email)
//   POST { token, password }        -> set the client's password, burn the link
// Only sets the password on the client's existing auth account; never
// creates accounts or changes role/status.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// j•••@gmail.com — enough for the client to recognise, not enough to harvest.
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return (user ? user[0] : "") + "•••@" + domain;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Looks up the link and its client; returns a reason when it isn't usable.
  async function load(token: string) {
    if (!token) return { reason: "not_found" as const };
    const { data: act } = await admin.from("client_activations")
      .select("id, profile_id, email, status, expires_at")
      .eq("token_hash", await sha256Hex(token)).maybeSingle();
    if (!act) return { reason: "not_found" as const };
    if (act.status !== "pending") return { reason: act.status as string };
    if (new Date(act.expires_at) < new Date()) {
      await admin.from("client_activations").update({ status: "expired" }).eq("id", act.id).eq("status", "pending");
      return { reason: "expired" as const };
    }
    const { data: prof } = await admin.from("profiles")
      .select("full_name, role, status").eq("id", act.profile_id).maybeSingle();
    if (!prof || prof.role !== "client" || !["active", "met"].includes(prof.status))
      return { reason: "revoked" as const };
    return { act, prof };
  }

  if (req.method === "GET") {
    const r = await load(new URL(req.url).searchParams.get("token") ?? "");
    if (!("act" in r)) return json({ valid: false, reason: r.reason });
    return json({ valid: true, full_name: r.prof!.full_name ?? "", email: maskEmail(r.act!.email) });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { token?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const token = (body.token ?? "").trim();
  const password = body.password ?? "";
  if (password.length < 8) return json({ error: "password_too_short" }, 400);
  if (password.length > 72) return json({ error: "password_too_long" }, 400);

  const r = await load(token);
  if (!("act" in r)) return json({ error: "link_" + r.reason }, 410);
  const act = r.act!;

  // Claim the link first so two concurrent submits can't both use it.
  const { data: claimed } = await admin.from("client_activations")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("id", act.id).eq("status", "pending").select("id");
  if (!claimed || !claimed.length) return json({ error: "link_used" }, 410);

  const { error: updErr } = await admin.auth.admin.updateUserById(act.profile_id, { password });
  if (updErr) {
    // Give the link back so the client can retry with a different password.
    await admin.from("client_activations").update({ status: "pending", used_at: null }).eq("id", act.id);
    return json({ error: "password_rejected", detail: updErr.message }, 400);
  }

  return json({ ok: true });
});
