import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://hoorash4.github.io";
const REDIRECT_URI = "https://hoorash4.github.io/macrowatch/";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "로그인이 필요합니다." }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const kakaoClientId = Deno.env.get("KAKAO_REST_API_KEY")!;
    const kakaoClientSecret = Deno.env.get("KAKAO_CLIENT_SECRET") || "";
    if (!kakaoClientId) return json({ error: "카카오 API 키가 설정되지 않았습니다." }, 500, origin);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "로그인 정보가 유효하지 않습니다." }, 401, origin);

    const userId = userData.user.id;
    const body = await request.json();
    const action = String(body?.action || "");

    const { data: existing } = await admin
      .from("notification_channels")
      .select("id, config, is_active")
      .eq("user_id", userId)
      .eq("channel", "kakao_self")
      .maybeSingle();
    const currentConfig = existing?.config && typeof existing.config === "object" ? existing.config : {};

    if (action === "status") {
      return json({ connected: Boolean(currentConfig.connected), is_active: existing?.is_active !== false }, 200, origin);
    }

    if (action === "start") {
      const state = crypto.randomUUID();
      const nextConfig = { ...currentConfig, oauth_state: state, wants_kakao: true };
      const { error } = await admin.from("notification_channels").upsert({
        user_id: userId,
        channel: "kakao_self",
        config: nextConfig,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,channel" });
      if (error) throw error;

      const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", kakaoClientId);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "talk_message");
      authorizeUrl.searchParams.set("state", state);
      return json({ authorize_url: authorizeUrl.toString() }, 200, origin);
    }

    if (action === "exchange") {
      const code = String(body?.code || "");
      const state = String(body?.state || "");
      if (!code || !state || state !== currentConfig.oauth_state) {
        return json({ error: "카카오 연결 요청을 확인할 수 없습니다. 다시 시도해 주세요." }, 400, origin);
      }

      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: kakaoClientId,
        redirect_uri: REDIRECT_URI,
        code,
      });
      if (kakaoClientSecret) tokenBody.set("client_secret", kakaoClientSecret);
      const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: tokenBody,
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) {
        return json({ error: tokenData.error_description || "카카오 토큰 발급에 실패했습니다." }, 400, origin);
      }

      const now = Date.now();
      const nextConfig = {
        ...currentConfig,
        oauth_state: null,
        connected: true,
        wants_kakao: true,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || currentConfig.refresh_token,
        access_expires_at: new Date(now + Number(tokenData.expires_in || 0) * 1000).toISOString(),
        refresh_expires_at: tokenData.refresh_token_expires_in
          ? new Date(now + Number(tokenData.refresh_token_expires_in) * 1000).toISOString()
          : currentConfig.refresh_expires_at,
        connected_at: new Date().toISOString(),
      };
      const { error } = await admin.from("notification_channels").upsert({
        user_id: userId,
        channel: "kakao_self",
        config: nextConfig,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,channel" });
      if (error) throw error;
      return json({ connected: true }, 200, origin);
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, 500, origin);
  }
  },
};

