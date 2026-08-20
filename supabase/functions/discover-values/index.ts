import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, Element } from "npm:linkedom@0.18.12";

const ALLOWED_ORIGIN = "https://hoorash4.github.io";
const MAX_HTML_BYTES = 1_500_000;
const MAX_CANDIDATES = 8;
const FETCH_TIMEOUT_MS = 12_000;

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

function isBlockedHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  if (value === "::1" || value === "0.0.0.0") return true;

  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function parseTargetUrl(rawUrl: unknown) {
  const url = new URL(String(rawUrl || "").trim());
  if (!["http:", "https:"].includes(url.protocol) || isBlockedHostname(url.hostname)) {
    throw new Error("공개된 HTTP 또는 HTTPS 웹페이지 주소만 사용할 수 있습니다.");
  }
  return url;
}

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeIdentifier(value: string) {
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function escapeAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function uniqueSelector(document: Document, element: Element) {
  const id = element.getAttribute("id");
  if (id) {
    const selector = `#${escapeIdentifier(id)}`;
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch {
      // 유효하지 않은 id는 다음 선택자 후보로 넘어갑니다.
    }
  }

  for (const attribute of ["data-testid", "data-test", "data-qa", "itemprop", "name"]) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = `[${attribute}="${escapeAttribute(value)}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch {
      // 유효하지 않은 속성값은 계층 선택자로 보완합니다.
    }
  }

  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "body" && segments.length < 5) {
    const tag = current.tagName.toLowerCase();
    const classNames = String(current.getAttribute("class") || "")
      .split(/\s+/)
      .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name))
      .slice(0, 2);

    let segment = tag + classNames.map((name) => `.${escapeIdentifier(name)}`).join("");
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName.toLowerCase() === tag,
      );
      if (siblings.length > 1) {
        segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    segments.unshift(segment);
    const selector = segments.join(" > ");
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch {
      // 계층을 한 단계 더 포함해 다시 확인합니다.
    }
    current = parent;
  }

  return segments.join(" > ");
}

function isExcludedElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "svg", "path", "nav", "footer"].includes(tag)) return true;
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;

  const style = String(element.getAttribute("style") || "").toLowerCase();
  if (style.includes("display:none") || style.includes("display: none") || style.includes("visibility:hidden")) {
    return true;
  }

  const role = String(element.getAttribute("role") || "").toLowerCase();
  return ["navigation", "menu", "banner", "contentinfo"].includes(role);
}

function extractNumber(text: string) {
  if (/\b\d{1,2}:\d{2}\b/.test(text)) return null;

  const normalized = text.replace(/[−–]/g, "-");
  const match = normalized.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match || match.index === undefined) return null;

  const compact = match[0].replace(/,/g, "");
  const numeric = Number(compact);
  if (!Number.isFinite(numeric)) return null;

  const isLikelyYear = /^\d{4}$/.test(compact) && numeric >= 1900 && numeric <= 2100;
  if (isLikelyYear && /(년|date|updated|published|작성|등록)/i.test(text)) return null;

  return {
    display: match[0],
    numeric,
    start: match.index,
    end: match.index + match[0].length,
  };
}

// 같은 숫자가 여러 번 나와도 구분할 수 있도록 바로 앞뒤 요소의 문구를 찾습니다.
function siblingText(element: Element, direction: "previous" | "next") {
  let sibling = direction === "previous"
    ? element.previousElementSibling
    : element.nextElementSibling;

  for (let depth = 0; sibling && depth < 3; depth += 1) {
    if (!isExcludedElement(sibling as Element)) {
      const text = normalizeSpace(sibling.textContent || "");
      if (text && text.length <= 120) return text;
    }
    sibling = direction === "previous"
      ? sibling.previousElementSibling
      : sibling.nextElementSibling;
  }
  return "";
}

// 가장 가까운 제목·라벨을 찾아 후보가 속한 페이지 영역을 설명합니다.
function sectionText(element: Element) {
  const directLabel = normalizeSpace(
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    "",
  );
  if (directLabel) return directLabel.slice(0, 100);

  let parent = element.parentElement;
  for (let depth = 0; parent && depth < 4; depth += 1) {
    const parentLabel = normalizeSpace(
      parent.getAttribute("aria-label") ||
      parent.getAttribute("title") ||
      "",
    );
    if (parentLabel) return parentLabel.slice(0, 100);

    const heading = parent.querySelector("h1, h2, h3, h4, h5, h6, legend, caption");
    const headingText = normalizeSpace(heading?.textContent || "");
    if (headingText && !heading?.contains(element)) return headingText.slice(0, 100);
    parent = parent.parentElement;
  }
  return "";
}

function scoreCandidate(element: Element, text: string, titleTokens: string[]) {
  const tag = element.tagName.toLowerCase();
  const metadata = [
    element.getAttribute("id"),
    element.getAttribute("class"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test"),
    element.getAttribute("aria-label"),
    element.getAttribute("itemprop"),
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;
  if (["strong", "b", "data", "output"].includes(tag)) score += 8;
  if (/price|value|rate|yield|index|last|current|quote|close|수치|현재|금리|지수|가격/.test(metadata)) score += 18;
  if (/[％%$₩€¥]|\b(bp|bps|pt|pts)\b/i.test(text)) score += 6;
  if (text.length <= 32) score += 8;
  if (element.children.length === 0) score += 6;

  const haystack = `${metadata} ${text.toLowerCase()}`;
  score += titleTokens.filter((token) => haystack.includes(token)).length * 7;
  return score;
}

function collectCandidates(document: Document, title: string, excludedKeys: Set<string>) {
  const titleTokens = title.toLowerCase().split(/[\s/|_-]+/).filter((token) => token.length >= 2);
  const candidates: Array<{
    value: number;
    display: string;
    context: string;
    left: string;
    right: string;
    section: string;
    selector: string;
    score: number;
  }> = [];
  const seen = new Set<string>();

  for (const node of Array.from(document.querySelectorAll("body *"))) {
    const element = node as Element;
    if (isExcludedElement(element) || element.children.length > 4) continue;

    const text = normalizeSpace(element.textContent || "");
    if (!text || text.length > 160) continue;

    const number = extractNumber(text);
    if (!number) continue;

    const selector = uniqueSelector(document, element);
    if (!selector) continue;

    const key = `${selector}|${number.display}`;
    if (seen.has(key) || excludedKeys.has(key)) continue;
    seen.add(key);

    const leftInElement = normalizeSpace(text.slice(Math.max(0, number.start - 70), number.start));
    const rightInElement = normalizeSpace(text.slice(number.end, number.end + 70));

    candidates.push({
      value: number.numeric,
      display: number.display,
      context: text.slice(0, 120),
      left: (leftInElement || siblingText(element, "previous")).slice(0, 100),
      right: (rightInElement || siblingText(element, "next")).slice(0, 100),
      section: sectionText(element),
      selector,
      score: scoreCandidate(element, text, titleTokens),
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.context.length - b.context.length)
    .slice(0, MAX_CANDIDATES)
    .map(({ score: _score, ...candidate }) => candidate);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405, origin);

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "로그인이 필요합니다." }, 401, origin);

    const body = await request.json();
    const url = parseTargetUrl(body.url);
    const title = String(body.title || "").trim().slice(0, 120);
    const excludedKeys = new Set(
      (Array.isArray(body.exclude) ? body.exclude : [])
        .slice(0, MAX_CANDIDATES)
        .map((value: unknown) => String(value).slice(0, 500)),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MacroWatch/1.0)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return json({ error: `웹페이지가 HTTP ${response.status} 오류를 반환했습니다.` }, 422, origin);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return json({ error: "HTML 웹페이지에서만 값을 자동으로 찾을 수 있습니다." }, 422, origin);
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_HTML_BYTES) {
      return json({ error: "웹페이지가 너무 커서 자동 분석할 수 없습니다." }, 413, origin);
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const document = new DOMParser().parseFromString(html, "text/html");
    const candidates = collectCandidates(document, title, excludedKeys);

    return json({
      candidates,
      message: candidates.length
        ? "가능성이 높은 값을 골라 주세요."
        : "정적 HTML에서 숫자 후보를 찾지 못했습니다. 고급 설정에서 CSS 선택자를 직접 입력해 주세요.",
    }, 200, origin);
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "웹페이지 응답 시간이 너무 오래 걸립니다."
      : error instanceof Error ? error.message : "웹페이지 분석에 실패했습니다.";
    return json({ error: message }, 400, origin);
  }
});
