import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalize(text: unknown) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function excludedCodeSet(values: unknown) {
  return new Set(
    Array.isArray(values)
      ? values.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
}

async function requireUser(request: Request) {
  const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("로그인이 필요합니다.");

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const auth = createClient(url, anonKey);
  const { data, error } = await auth.auth.getUser(jwt);
  if (error || !data.user) throw new Error("로그인이 필요합니다.");
}

async function searchFred(searchTerms: unknown, excludedCodes: Set<string>) {
  const key = Deno.env.get("FRED_API_KEY");
  if (!key) throw new Error("FRED 검색 설정이 없습니다.");

  const terms = Array.isArray(searchTerms)
    ? [...new Set(searchTerms.map((term) => String(term || "").trim()).filter(Boolean))].slice(0, 4)
    : [];
  const candidates = [];
  const knownIds = new Set<string>(excludedCodes);

  for (const searchText of terms) {
    const url = new URL("https://api.stlouisfed.org/fred/series/search");
    url.search = new URLSearchParams({
      api_key: key,
      file_type: "json",
      search_text: searchText,
      order_by: "search_rank",
      sort_order: "desc",
      limit: "100",
    }).toString();

    const response = await fetch(url);
    if (!response.ok) throw new Error(`FRED 검색 중 오류가 발생했습니다. (${response.status})`);
    const payload = await response.json();

    for (const series of payload.seriess || []) {
      if (knownIds.has(series.id)) continue;
      knownIds.add(series.id);
      candidates.push({
        source: "FRED",
        kind: "series",
        title: series.title,
        code: series.id,
        frequency: series.frequency || "",
        unit: series.units || "",
      });
    }
  }

  return candidates.slice(0, 16);
}

async function searchEcosTables(query: string, excludedCodes: Set<string>) {
  const key = Deno.env.get("ECOS_API_KEY");
  if (!key) throw new Error("ECOS 검색 설정이 없습니다.");

  const url = [
    "https://ecos.bok.or.kr/api/StatisticTableList",
    encodeURIComponent(key),
    "json",
    "kr",
    "1",
    "10000",
  ].join("/");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`ECOS 검색 중 오류가 발생했습니다. (${response.status})`);
  const payload = await response.json();
  const words = normalize(query).split(" ").filter((word) => word.length > 1);

  return (payload.StatisticTableList?.row || [])
    .filter((table: Record<string, unknown>) => {
      const title = normalize(table.STAT_NAME);
      return !excludedCodes.has(String(table.STAT_CODE || "")) && words.length > 0 && words.every((word) => title.includes(word));
    })
    .slice(0, 12)
    .map((table: Record<string, unknown>) => ({
      source: "ECOS",
      kind: "table",
      title: String(table.STAT_NAME || ""),
      code: String(table.STAT_CODE || ""),
      frequency: String(table.CYCLE || ""),
      unit: "",
    }));
}

async function searchEcosItems(statCode: string, tableTitle: string) {
  const key = Deno.env.get("ECOS_API_KEY");
  if (!key) throw new Error("ECOS 검색 설정이 없습니다.");

  const url = [
    "https://ecos.bok.or.kr/api/StatisticItemList",
    encodeURIComponent(key),
    "json",
    "kr",
    "1",
    "1000",
    encodeURIComponent(statCode),
  ].join("/");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`ECOS 항목을 불러오는 중 오류가 발생했습니다. (${response.status})`);
  const payload = await response.json();

  return (payload.StatisticItemList?.row || [])
    .filter((item: Record<string, unknown>) => item.ITEM_CODE1 && !item.ITEM_CODE2 && !item.ITEM_CODE3 && !item.ITEM_CODE4)
    .slice(0, 100)
    .map((item: Record<string, unknown>) => ({
      source: "ECOS",
      kind: "series",
      title: `${tableTitle} · ${String(item.ITEM_NAME1 || "")}`,
      code: statCode,
      itemCode: String(item.ITEM_CODE1 || ""),
      frequency: String(item.CYCLE || ""),
      unit: String(item.UNIT_NAME || ""),
    }));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  try {
    await requireUser(request);
    const body = await request.json();
    const action = String(body.action || "search");
    const query = String(body.query || "").trim();

    if (action === "search") {
      if (query.length < 2) return respond({ error: "검색어를 두 글자 이상 입력해 주세요." }, 400);
      const excludedCodes = excludedCodeSet(body.excludedCodes);
      const [fred, ecos] = await Promise.allSettled([searchFred(body.fredQueries, excludedCodes), searchEcosTables(query, excludedCodes)]);
      const results = [
        ...(fred.status === "fulfilled" ? fred.value : []),
        ...(ecos.status === "fulfilled" ? ecos.value : []),
      ];
      const errors = [fred, ecos]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : "검색 오류");

      if (!results.length && errors.length) throw new Error(errors.join(" / "));
      return respond({
        results,
        fredSearchTerms: Array.isArray(body.fredQueries) ? body.fredQueries.slice(0, 4) : [],
        warning: errors.length ? errors.join(" / ") : "",
      });
    }

    if (action === "ecos-items") {
      const statCode = String(body.statCode || "").trim();
      const tableTitle = String(body.tableTitle || "").trim();
      if (!statCode) return respond({ error: "ECOS 통계표 코드가 없습니다." }, 400);
      return respond({ results: await searchEcosItems(statCode, tableTitle) });
    }

    return respond({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "지표 후보를 불러오지 못했습니다.";
    return respond({ error: message }, message.includes("로그인이 필요합니다") ? 401 : 400);
  }
});
