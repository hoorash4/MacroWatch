import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://hoorash4.github.io";
const REPOSITORY = "hoorash4/macrowatch";
const BRANCH = "main";
const CHECK_WORKFLOW = "check-targets.yml";
const BACKUP_WORKFLOW = "backup-database.yml";

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

function githubHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
    ...init,
    headers: { ...githubHeaders(token), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `GitHub 요청 실패 (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function latestRun(workflow: string, token: string) {
  const data = await githubRequest(
    `/actions/workflows/${workflow}/runs?per_page=1`,
    token,
  );
  const run = data?.workflow_runs?.[0];
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    run_started_at: run.run_started_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  };
}

async function authenticatedUser(supabaseUrl: string, anonKey: string, jwt: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

function validateTimes(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("확인 시간 두 개를 입력해 주세요.");
  }
  const times = value.map((item) => String(item));
  if (times.some((item) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(item))) {
    throw new Error("시간 형식이 올바르지 않습니다.");
  }
  if (new Set(times).size !== times.length) {
    throw new Error("서로 다른 시간을 입력해 주세요.");
  }
  return times.sort();
}

function kstTimeToCron(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const utcMinutes = (hour * 60 + minute - 9 * 60 + 24 * 60) % (24 * 60);
  return `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function updateWorkflowSchedule(times: string[], token: string) {
  const path = "/contents/.github/workflows/check-targets.yml";
  const file = await githubRequest(`${path}?ref=${BRANCH}`, token);
  const current = atob(String(file.content || "").replace(/\s/g, ""));
  const cronLines = times.map((time) => `    - cron: "${kstTimeToCron(time)}"`).join("\n");
  const next = current.replace(
    /  schedule:\r?\n[\s\S]*?  workflow_dispatch:/,
    `  schedule:\n    # GitHub Actions cron uses UTC. Managed from MacroWatch admin.\n${cronLines}\n  workflow_dispatch:`,
  );
  if (next === current) return;

  await githubRequest(path, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `Update target check schedule to ${times.join(", ")} KST`,
      content: encodeBase64(next),
      sha: file.sha,
      branch: BRANCH,
    }),
  });
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

    try {
      const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "로그인이 필요합니다." }, 401, origin);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const githubToken = Deno.env.get("GITHUB_ADMIN_TOKEN")!;
      if (!githubToken) return json({ error: "GitHub 관리자 토큰이 없습니다." }, 500, origin);

      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const requestApiKey = request.headers.get("apikey") || anonKey;
      const user = await authenticatedUser(supabaseUrl, requestApiKey, jwt);
      if (!user) {
        return json({ error: "로그인 정보가 유효하지 않습니다." }, 401, origin);
      }
      const { data: account } = await admin
        .from("user_accounts")
        .select("is_admin")
        .eq("user_id", user.id)
        .maybeSingle();
      if (account?.is_admin !== true) {
        return json({ error: "관리자 권한이 필요합니다." }, 403, origin);
      }

      const body = await request.json();
      const action = String(body?.action || "");

      if (action === "workflow_status") {
        const kind = String(body?.kind || "");
        if (kind !== "check" && kind !== "backup") {
          return json({ error: "확인할 작업 종류가 올바르지 않습니다." }, 400, origin);
        }
        const workflow = kind === "check" ? CHECK_WORKFLOW : BACKUP_WORKFLOW;
        return json({ run: await latestRun(workflow, githubToken) }, 200, origin);
      }

      if (action === "register_api_source") {
        const source = body?.source || {};
        const providerUrl = String(source.provider_url || "").trim();
        const baseUrl = String(source.base_url || "").trim();
        const responsePath = String(source.response_path || "").trim();
        if (!providerUrl || !baseUrl || !responsePath) {
          return json({ error: "제공기관 주소, API 주소, 응답값 경로를 입력해 주세요." }, 400, origin);
        }
        let provider: URL;
        let endpoint: URL;
        try {
          provider = new URL(providerUrl);
          endpoint = new URL(baseUrl);
        } catch {
          return json({ error: "주소 형식이 올바르지 않습니다." }, 400, origin);
        }
        if (provider.protocol !== "https:" || endpoint.protocol !== "https:") {
          return json({ error: "보안을 위해 HTTPS 주소만 등록할 수 있습니다." }, 400, origin);
        }
        if (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname.endsWith(".local")) {
          return json({ error: "내부 네트워크 주소는 등록할 수 없습니다." }, 400, origin);
        }
        const payload = {
          name: String(source.name || endpoint.hostname).trim().slice(0, 120),
          provider_url: provider.toString(),
          documentation_url: String(source.documentation_url || "").trim() || null,
          base_url: endpoint.toString(),
          auth_location: ["none", "query", "header"].includes(String(source.auth_location || "none")) ? String(source.auth_location || "none") : "none",
          auth_name: String(source.auth_name || "").trim() || null,
          secret_name: String(source.secret_name || "").trim() || null,
          method: String(source.method || "GET").toUpperCase() === "POST" ? "POST" : "GET",
          request_params: typeof source.request_params === "object" && source.request_params ? source.request_params : {},
          request_headers: typeof source.request_headers === "object" && source.request_headers ? source.request_headers : {},
          response_path: responsePath,
          code_parameter: String(source.code_parameter || "").trim() || null,
          legal_review: "pending",
          legal_notes: String(source.legal_notes || "").trim() || null,
          is_active: false,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await admin.from("api_sources").upsert(payload, { onConflict: "name" }).select().single();
        if (error) throw error;
        return json({ source: data, message: "API 설정을 저장했습니다. 약관 검토 후 활성화해 주세요." }, 201, origin);
      }

      if (action === "status") {
        const [
          { data: settings },
          check,
          backup,
          { count: total, error: totalError },
          { count: active, error: activeError },
          { count: errorCount, error: errorCountError },
          { data: errors, error: errorsError },
        ] = await Promise.all([
          admin.from("app_settings").select("value, updated_at").eq("key", "target_check_schedule").maybeSingle(),
          latestRun(CHECK_WORKFLOW, githubToken),
          latestRun(BACKUP_WORKFLOW, githubToken),
          admin.from("targets").select("id", { count: "exact", head: true }),
          admin.from("targets").select("id", { count: "exact", head: true }).eq("is_active", true),
          admin.from("targets").select("id", { count: "exact", head: true }).not("last_error", "is", null).neq("last_error", ""),
          admin.from("targets")
            .select("id,title,last_error,last_checked_at")
            .not("last_error", "is", null)
            .neq("last_error", "")
            .order("last_checked_at", { ascending: false, nullsFirst: false })
            .limit(100),
        ]);
        const databaseError = totalError || activeError || errorCountError || errorsError;
        if (databaseError) throw databaseError;
        return json({
          schedule: settings?.value || { times: ["08:00", "18:00"], timezone: "Asia/Seoul" },
          schedule_updated_at: settings?.updated_at || null,
          check,
          backup,
          database: {
            total: total || 0,
            active: active || 0,
            error_count: errorCount || 0,
            errors: errors || [],
          },
        }, 200, origin);
      }

      if (action === "run_check" || action === "run_backup") {
        const workflow = action === "run_check" ? CHECK_WORKFLOW : BACKUP_WORKFLOW;
        const requestedAt = new Date().toISOString();
        await githubRequest(`/actions/workflows/${workflow}/dispatches`, githubToken, {
          method: "POST",
          body: JSON.stringify({ ref: BRANCH }),
        });
        return json({ requested_at: requestedAt }, 202, origin);
      }

      if (action === "update_schedule") {
        const times = validateTimes(body?.times);
        await updateWorkflowSchedule(times, githubToken);
        const { error } = await admin.from("app_settings").upsert({
          key: "target_check_schedule",
          value: { times, timezone: "Asia/Seoul" },
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        });
        if (error) throw error;
        return json({ schedule: { times, timezone: "Asia/Seoul" } }, 200, origin);
      }

      return json({ error: "지원하지 않는 요청입니다." }, 400, origin);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "요청 처리에 실패했습니다." }, 500, origin);
    }
  },
};

