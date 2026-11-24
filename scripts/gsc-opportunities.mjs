#!/usr/bin/env node
// Search Console 기회검색어 수집 → content/keywords/opportunities.json
// 인증: 서비스계정 JWT(RS256, Node 내장 crypto) → OAuth 토큰. 외부 의존성 없음.
// 키: env GSC_SA_KEY(JSON 문자열) 또는 GSC_SA_FILE(파일 경로).
import crypto from "node:crypto";
import fs from "node:fs";

const SITE = process.env.GSC_SITE || "https://app.voxen.io/";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MIN_IMPR = Number(process.env.MIN_IMPR || 20); // 신생 사이트라 낮게; 데이터 쌓이면 올릴 것
const CTR_MAX = Number(process.env.CTR_MAX || 2);     // % — 이 미만이면 낮은 CTR

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token error: " + JSON.stringify(j));
  return j.access_token;
}

async function query(token, body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.error) throw new Error("query error: " + JSON.stringify(j.error));
  return j.rows || [];
}

const ymd = (d) => d.toISOString().slice(0, 10);

(async () => {
  const raw = process.env.GSC_SA_KEY || (process.env.GSC_SA_FILE && fs.readFileSync(process.env.GSC_SA_FILE, "utf8"));
  if (!raw) throw new Error("GSC_SA_KEY 또는 GSC_SA_FILE 환경변수가 필요합니다.");
  const sa = JSON.parse(raw);
  const token = await getToken(sa);

  const end = new Date(Date.now() - 2 * 86400000); // GSC 2~3일 지연
  const start = new Date(end.getTime() - 28 * 86400000);

  const rows = await query(token, {
    startDate: ymd(start), endDate: ymd(end),
    dimensions: ["query", "page"], rowLimit: 25000, dataState: "all",
  });

  const classify = (o) => {
    if (o.position <= 10 && o.ctr < CTR_MAX) return "ctr_fix";        // 상위권인데 CTR 낮음 → 제목·메타 개선
    if (o.position > 10 && o.position <= 30) return "rank_push";      // 2~3페이지 → 개선 또는 전용 글
    if (o.position > 30 && o.clicks === 0) return "gap";              // 노출만 쌓이고 클릭 0 (순위 무관) → 전용 글 (Vaultaire 방식)
    return null;
  };

  const opps = rows
    .map((r) => ({
      query: r.keys[0], page: r.keys[1],
      clicks: r.clicks, impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
    }))
    .filter((o) => o.impressions >= MIN_IMPR)
    .map((o) => ({ ...o, type: classify(o) }))
    .filter((o) => o.type)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 100);

  const out = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    dateRange: { start: ymd(start), end: ymd(end) },
    note: "GSC 기회검색어. ctr_fix=상위10위인데 CTR<2% → 해당 page의 제목·메타 다시 쓰기. rank_push=2~3페이지(순위 10~30) → 개선 또는 전용 글. gap=30위 밖에서 노출만 쌓이고 클릭 0 → 그 검색어를 정면으로 답하는 전용 글. 비어있지 않으면 seed.json보다 우선.",
    thresholds: { minImpressions: MIN_IMPR, ctrMaxPct: CTR_MAX },
    count: opps.length,
    opportunities: opps,
  };
  fs.mkdirSync("content/keywords", { recursive: true });
  fs.writeFileSync("content/keywords/opportunities.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ opportunities: ${opps.length}건 (impr>=${MIN_IMPR}, 대상 ${rows.length}행) → content/keywords/opportunities.json`);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
