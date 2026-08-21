import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://hoorash4.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function dateParts() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10).replaceAll("-", "");
  const startDate = new Date(now.getTime() - 370 * 86400000);
  const start = startDate.toISOString().slice(0, 10).replaceAll("-", "");
  return { start, end };
}

async function collect(target: any) {
  const config = target.source_config || {};
  if (target.source_type === "fred") {
    const key = Deno.env.get("FRED_API_KEY");
    if (!key) throw new Error("FRED API 키가 백엔드에 등록되지 않았습니다.");
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.search = new URLSearchParams({
      series_id: String(config.series_id || "").toUpperCase(),
      api_key: key,
      file_type: "json",
      sort_order: "desc",
      limit: "10",
    }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FRED API 오류 (${response.status})`);
    const rows = (await response.json()).observations || [];
    const row = rows.find((item: any) => item.value && item.value !== ".");
    if (!row) throw new Error("FRED 최신값을 찾지 못했습니다.");
    return Number(row.value);
  }

  if (target.source_type === "ecos") {
    const key = Deno.env.get("ECOS_API_KEY");
    if (!key) throw new Error("ECOS API 키가 백엔드에 등록되지 않았습니다.");
    const { start, end } = dateParts();
    const cycle = String(config.data_cycle || "D").toUpperCase();
    const stat = encodeURIComponent(String(config.stat_code || "").toUpperCase());
    const item = encodeURIComponent(String(config.item_code || ""));
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/100/${stat}/${cycle}/${start}/${end}/${item}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ECOS API 오류 (${response.status})`);
    const rows = (await response.json()).StatisticSearch?.row || [];
    const row = rows.reverse().find((item: any) => item.DATA_VALUE !== undefined && item.DATA_VALUE !== "");
    if (!row) throw new Error("ECOS 최신값을 찾지 못했습니다.");
    return Number(String(row.DATA_VALUE).replaceAll(",", ""));
  }

  throw new Error("지원하지 않는 데이터 소스입니다.");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return reply({ error: "로그인이 필요합니다." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !userData.user) return reply({ error: "로그인이 필요합니다." }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    const body = await request.json();
    const targetId = String(body.target_id || "");
    if (!targetId) return reply({ error: "지표 ID가 필요합니다." }, 400);
    const { data: target, error: targetError } = await db.from("targets").select("*").eq("id", targetId).eq("user_id", userData.user.id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return reply({ error: "해당 지표를 찾을 수 없습니다." }, 404);
    const value = await collect(target);
    const checkedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await db.from("targets").update({ last_value: value, last_checked_at: checkedAt, last_error: null }).eq("id", targetId).select().single();
    if (updateError) throw updateError;
    return reply({ target: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "현재값을 확인하지 못했습니다.";
    return reply({ error: message }, 400);
  }
});
