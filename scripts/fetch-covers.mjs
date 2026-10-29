#!/usr/bin/env node
// 글 frontmatter의 coverQuery로 Unsplash 검색 페이지(HTML)를 읽어 CDN 사진 주소를 찾고
// content/covers.json에 고정한다. 빌드(GitHub Actions)에서 실행. API 키 불필요.
// - 브라우저 UA를 보내면 봇 차단(Anubis) 챌린지가 뜨므로 UA는 기본값(node)으로 보낸다.
// - Unsplash+ 유료 사진(plus.unsplash.com)은 제외하고, 가로 사진만 고른다.
// - 다른 사진으로 바꾸려면 covers.json에서 해당 슬러그 항목을 지우면 다음 빌드에서 다시 찾는다.
// - UNSPLASH_ACCESS_KEY가 있으면 스크래핑 실패 시 공식 API로 한 번 더 시도한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSTS = path.join(ROOT, "content", "posts");
const OUT = path.join(ROOT, "content", "covers.json");
const UTM = "utm_source=voxen_dev_blog&utm_medium=referral";
const KEY = process.env.UNSPLASH_ACCESS_KEY;

const covers = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const used = new Set(Object.values(covers).map((c) => c.id));
const unent = (s = "") => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const todo = fs.readdirSync(POSTS).filter((f) => f.endsWith(".md")).map((file) => {
  const { data } = matter(fs.readFileSync(path.join(POSTS, file), "utf8"));
  const slug = data.slug || file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return { slug, query: data.coverQuery, cover: data.cover };
}).filter((p) => p.query && !p.cover && !covers[p.slug]);

if (!todo.length) { console.log("새로 조회할 커버 없음"); process.exit(0); }

// 검색 페이지 HTML → 후보 사진 목록
async function scrape(query) {
  const url = `https://unsplash.com/s/photos/${encodeURIComponent(query.trim().replace(/\s+/g, "-"))}?orientation=landscape`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`search page ${res.status}`);
  const html = await res.text();
  const figures = html.split('<figure').slice(1);
  const out = [];
  for (const f of figures) {
    const img = f.match(/<img alt="([^"]*)"[^>]*src="(https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+)\?[^"]*"[^>]*width="(\d+)" height="(\d+)"/);
    const link = f.match(/href="\/photos\/([^"?]+)"/);
    const user = f.match(/href="\/@([^"?]+)"[^>]*>([^<]+)<\/a>/);
    if (!img || !link || !user) continue;
    if (Number(img[3]) <= Number(img[4])) continue; // 세로 사진 제외
    const id = link[1].split("-").pop();
    out.push({
      id, raw: img[2], alt: unent(img[1]), photographer: unent(user[2].trim()),
      photographerUrl: `https://unsplash.com/@${user[1]}?${UTM}`,
      unsplashUrl: `https://unsplash.com/photos/${link[1]}?${UTM}`,
    });
  }
  if (!out.length) throw new Error("HTML에서 사진을 찾지 못함 (페이지 구조 변경 또는 봇 차단)");
  return out;
}

// 공식 API (키가 있을 때만 폴백)
async function viaApi(query) {
  const headers = { Authorization: `Client-ID ${KEY}`, "Accept-Version": "v1" };
  const q = new URLSearchParams({ query, orientation: "landscape", content_filter: "high", per_page: "10" });
  const res = await fetch(`https://api.unsplash.com/search/photos?${q}`, { headers });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const { results } = await res.json();
  return results.map((r) => ({
    id: r.id, raw: r.urls.raw.split("?")[0], alt: r.alt_description || r.description || query,
    photographer: r.user.name, photographerUrl: `${r.user.links.html}?${UTM}`,
    unsplashUrl: `${r.links.html}?${UTM}`, download: r.links.download_location,
  }));
}

let changed = false;
for (const p of todo) {
  try {
    let candidates;
    try { candidates = await scrape(p.query); }
    catch (e) {
      if (!KEY) throw e;
      console.warn(`  스크래핑 실패(${e.message}) → API로 재시도`);
      candidates = await viaApi(p.query);
    }
    const photo = candidates.find((c) => !used.has(c.id)) || candidates[0];
    if (photo.download) await fetch(photo.download, { headers: { Authorization: `Client-ID ${KEY}` } }).catch(() => {});
    const { download, ...entry } = photo;
    covers[p.slug] = { query: p.query, ...entry };
    used.add(photo.id); changed = true;
    console.log(`✓ ${p.slug}: "${p.query}" → ${photo.id} by ${photo.photographer}`);
  } catch (e) { console.warn(`✗ ${p.slug}: ${e.message}`); }
}

if (changed) {
  const sorted = Object.fromEntries(Object.keys(covers).sort().map((k) => [k, covers[k]]));
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
  console.log("covers.json 갱신");
}
