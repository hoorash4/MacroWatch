import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

type GlossaryEntry = {
  terms: string[];
  queries: string[];
};

/**
 * 한국어 경제지표 검색어를 FRED 검색어 후보로 넓히는 공통 사전입니다.
 * 전체 문장보다 구체적인 표현을 먼저 두어, 긴 표현이 우선 적용되게 합니다.
 */
const FRED_GLOSSARY: GlossaryEntry[] = [
  { terms: ["미국 10년물 국채금리", "미국 10년물 금리"], queries: ["10-Year Treasury Constant Maturity Rate", "10-Year Treasury Rate", "10-Year Treasury Yield"] },
  { terms: ["미국 2년물 국채금리", "미국 2년물 금리"], queries: ["2-Year Treasury Constant Maturity Rate", "2-Year Treasury Rate", "2-Year Treasury Yield"] },
  { terms: ["신규 실업수당 청구건수", "신규실업수당청구건수", "신규 실업 청구"], queries: ["Initial Claims", "Initial Unemployment Insurance Claims"] },
  { terms: ["계속 실업수당 청구건수", "계속실업수당청구건수", "연속 실업수당 청구"], queries: ["Continued Claims", "Continued Unemployment Insurance Claims"] },
  { terms: ["실업수당 청구건수", "실업수당청구건수"], queries: ["Unemployment Insurance Claims", "Initial Claims"] },
  { terms: ["하이일드 스프레드", "하이일드스프레드"], queries: ["High Yield Spread", "ICE BofA US High Yield Index Option-Adjusted Spread"] },
  { terms: ["장단기 금리차", "장단기금리차"], queries: ["Treasury Yield Spread", "10-Year Treasury Constant Maturity Minus 2-Year Treasury Constant Maturity"] },
  { terms: ["소비자물가", "소비자 물가", "cpi"], queries: ["Consumer Price Index", "CPI"] },
  { terms: ["생산자물가", "생산자 물가", "ppi"], queries: ["Producer Price Index", "PPI"] },
  { terms: ["개인소비지출", "개인 소비 지출", "pce"], queries: ["Personal Consumption Expenditures", "PCE Price Index"] },
  { terms: ["비농업고용", "비농업 고용", "비농업부문 고용"], queries: ["All Employees Total Nonfarm", "Nonfarm Payrolls"] },
  { terms: ["실업률"], queries: ["Unemployment Rate"] },
  { terms: ["기업연체율", "기업 연체율"], queries: ["Business Delinquency Rate", "Delinquency Rate on Business Loans"] },
  { terms: ["연체율"], queries: ["Delinquency Rate"] },
  { terms: ["신용카드 연체율", "신용카드연체율"], queries: ["Credit Card Delinquency Rate"] },
  { terms: ["모기지 연체율", "모기지연체율"], queries: ["Mortgage Delinquency Rate"] },
  { terms: ["상업용 부동산 연체율", "상업용부동산 연체율"], queries: ["Commercial Real Estate Delinquency Rate"] },
  { terms: ["주택착공", "주택 착공"], queries: ["Housing Starts"] },
  { terms: ["소매판매", "소매 판매"], queries: ["Retail Sales"] },
  { terms: ["산업생산", "산업 생산"], queries: ["Industrial Production"] },
  { terms: ["통화량"], queries: ["Money Stock", "Money Supply"] },
  { terms: ["달러인덱스", "달러 인덱스"], queries: ["Trade Weighted U.S. Dollar Index"] },
  { terms: ["기준금리"], queries: ["Federal Funds Effective Rate", "Federal Funds Target Range"] },
  { terms: ["모기지 금리", "모기지금리"], queries: ["Mortgage Rate"] },
  { terms: ["국채금리", "국채 금리"], queries: ["Treasury Rate", "Treasury Yield"] },
  { terms: ["채권 수익률", "채권수익률"], queries: ["Bond Yield"] },
  { terms: ["배당수익률", "배당 수익률"], queries: ["Dividend Yield"] },
  { terms: ["실질수익률", "실질 수익률"], queries: ["Real Yield"] },
  { terms: ["국내총생산", "gdp"], queries: ["Gross Domestic Product", "GDP"] },
  { terms: ["고용"], queries: ["Employment"] },
  { terms: ["인플레이션", "물가"], queries: ["Inflation"] },
  { terms: ["수익률"], queries: ["Yield"] },
  { terms: ["금리"], queries: ["Interest Rate"] },
].sort((left, right) =>
  Math.max(...right.terms.map((term) => term.length)) - Math.max(...left.terms.map((term) => term.length))
);

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalize(text: unknown) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function fredQueries(query: string) {
  const normalized = normalize(query);
  const results: string[] = [];

  for (const entry of FRED_GLOSSARY) {
    if (entry.terms.some((term) => normalized.includes(normalize(term)))) {
      results.push(...entry.queries);
    }
  }

  if (/[a-z]/i.test(query)) results.unshift(query.trim());
  return [...new Set(results)].slice(0, 4);
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

async function searchFred(query: string) {
  const key = Deno.env.get("FRED_API_KEY");
  if (!key) throw new Error("FRED 검색 설정이 없습니다.");

  const candidates = [];
  const knownIds = new Set<string>();

  for (const searchText of fredQueries(query)) {
    const url = new URL("https://api.stlouisfed.org/fred/series/search");
    url.search = new URLSearchParams({
      api_key: key,
      file_type: "json",
      search_text: searchText,
      order_by: "search_rank",
      sort_order: "desc",
      limit: "8",
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

async function searchEcosTables(query: string) {
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
      return words.length > 0 && words.every((word) => title.includes(word));
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
      const [fred, ecos] = await Promise.allSettled([searchFred(query), searchEcosTables(query)]);
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
        fredSearchTerms: fredQueries(query),
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
