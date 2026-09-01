import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync("C:/Projects/tekguyz-squid-ink/.env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1)]));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:false}});
const { data: s, error } = await anon.auth.signInWithPassword({ email: env.RLS_TEST_OWNER_EMAIL, password: env.RLS_TEST_OWNER_PASSWORD });
if (error) throw error;
const owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}, auth:{persistSession:false} });
const IDS = { uploading: "bbbbbbb0-9999-4000-8000-000000000001", analyzing: "bbbbbbb0-9999-4000-8000-000000000002", failed: "bbbbbbb0-9999-4000-8000-000000000003" };
if (process.argv[2] === "clean") {
  for (const id of Object.values(IDS)) await owner.from("notes").delete().eq("id", id);
  console.log("cleaned");
} else {
  for (const [status, id] of Object.entries(IDS)) {
    const { error: e } = await owner.from("notes").insert({ id, user_id: s.user.id, title: `Pill sample — ${status}`, processing_status: status, audio_duration_seconds: 30 });
    if (e) throw e;
  }
  console.log("seeded", IDS);
}
