import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: cors });
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const adminClient = createClient(url, service);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: cors });

    const body = await req.json();
    const fileId = String(body.file_id || "");
    if (!fileId) return new Response(JSON.stringify({ error: "file_id is required" }), { status: 400, headers: cors });
    const { data: file, error: fileError } = await adminClient.from("files").select("id,owner_id,display_name,original_name").eq("id", fileId).maybeSingle();
    if (fileError) throw fileError;
    if (!file || file.owner_id !== user.id) return new Response(JSON.stringify({ error: "You can only share your own files" }), { status: 403, headers: cors });

    const mode = body.mode === "view" ? "view" : "download";
    const expiresAt = body.expires_at ? new Date(body.expires_at).toISOString() : null;
    const token = crypto.randomUUID().replaceAll("-", "");
    const { data, error } = await adminClient.from("share_links").insert({ file_id: fileId, owner_id: user.id, token, mode, expires_at: expiresAt, disabled: false })
      .select("id,token,mode,expires_at,disabled,created_at").single();
    if (error) throw error;
    await adminClient.from("activity_logs").insert({ actor_id: user.id, action: "share_link_created", entity_type: "share_link", entity_id: data.id, metadata: { file_id: fileId, mode } });
    return new Response(JSON.stringify({ share: data }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Server error" }), { status: 500, headers: cors });
  }
});
