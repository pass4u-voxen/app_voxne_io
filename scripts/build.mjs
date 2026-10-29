#!/usr/bin/env node
// VOXEN Dev 블로그 생성기 — 마크다운 → 정적 HTML (Search Console 최적화)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const WANT_DRAFTS = process.argv.includes("--drafts");

const cfg = readJson(path.join(ROOT, "config.json"));
const appsReg = readJson(path.join(ROOT, "content", "apps.json")).apps || [];
const appBySlug = Object.fromEntries(appsReg.map((a) => [a.slug, a]));

marked.setOptions({ gfm: true, breaks: false });

// ---------- helpers ----------
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function write(rel, html) {
  const out = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}
function ymd(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString().slice(0, 10);
}
function fmtDate(d) {
  const [y, m, day] = ymd(d).split("-");
  return `${y}.${m}.${day}`;
}
function rfc822(d) { return new Date(`${d}T09:00:00+09:00`).toUTCString(); }
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, t) : fs.copyFileSync(s, t);
  }
}
const abs = (p) => cfg.base + p;

// ---------- load posts ----------
const postsDir = path.join(ROOT, "content", "posts");
let posts = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md")).map((file) => {
  const raw = fs.readFileSync(path.join(postsDir, file), "utf8");
  const { data, content } = matter(raw);
  const slug = data.slug || file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const date = ymd(data.date || file.slice(0, 10));
  return {
    slug, title: data.title || slug, description: data.description || "",
    app: data.app || null, date, updated: ymd(data.updated || date),
    tags: data.tags || [], cover: data.cover || "", draft: !!data.draft,
    html: marked.parse(content), url: `/${slug}/`,
  };
}).filter((p) => WANT_DRAFTS || !p.draft);

posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
if (new Set(posts.map((p) => p.slug)).size !== posts.length)
  throw new Error("중복 슬러그가 있습니다. 파일명/슬러그를 확인하세요.");

// ---------- layout ----------
function layout({ title, description, canonical, headExtra = "", body, ogType = "website", ogImage }) {
  const img = abs(ogImage || cfg.defaultOgImage);
  const navApps = appsReg.filter((a) => posts.some((p) => p.app === a.slug)).slice(0, 6);
  return `<!doctype html><html lang="${cfg.lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
<meta name="google-site-verification" content="${esc(cfg.googleSiteVerification)}">
<meta property="og:type" content="${ogType}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(cfg.brand)}"><meta property="og:image" content="${esc(img)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.brand)} RSS" href="/feed.xml">
<link rel="stylesheet" href="/assets/style.css">
${headExtra}
</head><body>
<header class="site"><div class="wrap">
<a class="brand" href="/"><span class="dot"></span>VOXEN <b>DEV</b></a>
<nav>${navApps.map((a) => `<a href="/apps/${a.slug}/">${esc(a.name)}</a>`).join("")}<a href="/feed.xml">RSS</a></nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="site"><div class="wrap">
<span>© ${new Date().getFullYear()} VOXEN</span>
<a href="https://voxen.io">voxen.io</a><a href="https://hompy.voxen.io">hompy</a>
<a class="sp" href="/feed.xml">RSS</a><a href="/sitemap.xml">사이트맵</a>
</div></footer>
</body></html>`;
}

function postCard(p) {
  const app = p.app && appBySlug[p.app];
  const tagTxt = app ? app.name : (p.tags[0] || "");
  return `<a class="post-card" href="${p.url}">
<div class="meta">${tagTxt ? `<span class="tag">${esc(tagTxt)}</span>` : ""}<span>${fmtDate(p.date)}</span></div>
<h2>${esc(p.title)}</h2>${p.description ? `<p>${esc(p.description)}</p>` : ""}</a>`;
}

// ---------- pages ----------
function renderPost(p) {
  const app = p.app && appBySlug[p.app];
  const canonical = abs(p.url);
  const ld = [{
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: p.title, description: p.description, datePublished: p.date, dateModified: p.updated,
    author: { "@type": "Organization", name: cfg.author, url: "https://voxen.io" },
    publisher: { "@type": "Organization", name: cfg.author, url: "https://voxen.io" },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    image: abs(p.cover || cfg.defaultOgImage), inLanguage: cfg.lang,
  }];
  const crumbItems = [{ name: "홈", item: cfg.base + "/" }];
  if (app) crumbItems.push({ name: app.name, item: abs(`/apps/${app.slug}/`) });
  crumbItems.push({ name: p.title, item: canonical });
  ld.push({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbItems.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
  });
  const headExtra = ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("");
  const related = p.app ? posts.filter((q) => q.app === p.app && q.slug !== p.slug).slice(0, 3) : [];
  const body = `<article class="post">
<p class="crumb"><a href="/">홈</a>${app ? ` · <a href="/apps/${app.slug}/">${esc(app.name)}</a>` : ""}</p>
<div class="meta">${app ? `<span class="tag">${esc(app.name)}</span>` : ""}<span>${fmtDate(p.date)}</span>${p.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>
<h1>${esc(p.title)}</h1>
${p.description ? `<p class="lede">${esc(p.description)}</p>` : ""}
<div class="content">${p.html}</div>
${app ? `<aside class="appbox"><div class="meta"><span class="tag">${esc(app.type || "앱")}</span><span>${esc(app.status || "")}</span></div>
<h3>${esc(app.name)}</h3><p>${esc(app.summary || app.tagline || "")}</p></aside>` : ""}
${related.length ? `<div class="appbox"><div class="meta"><span>이어 보기</span></div>${related.map(postCard).join("")}</div>` : ""}
</article>`;
  write(`${p.slug}/index.html`, layout({
    title: `${p.title} — ${cfg.brand}`, description: p.description || cfg.description,
    canonical, headExtra, body, ogType: "article", ogImage: p.cover || cfg.defaultOgImage,
  }));
}

function renderHome() {
  const chips = appsReg.filter((a) => posts.some((p) => p.app === a.slug))
    .map((a) => `<a class="chip" href="/apps/${a.slug}/">${esc(a.name)}</a>`).join("");
  const body = `<section class="hero">
<p class="eyebrow">VOXEN · DEVLOG</p>
<h1>${esc(cfg.title.split("—")[0].trim())}</h1>
<p>${esc(cfg.description)}</p>
${chips ? `<div class="chips">${chips}</div>` : ""}
</section>
<section class="list">${posts.length ? posts.map(postCard).join("") : `<p class="empty">첫 글을 준비 중입니다.</p>`}</section>`;
  const ld = {
    "@context": "https://schema.org", "@type": "Blog", name: cfg.brand, url: cfg.base + "/",
    description: cfg.description, inLanguage: cfg.lang,
    publisher: { "@type": "Organization", name: cfg.author, url: "https://voxen.io" },
  };
  write("index.html", layout({
    title: cfg.title, description: cfg.description, canonical: cfg.base + "/",
    headExtra: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`, body,
  }));
}

function renderAppArchive(app) {
  const list = posts.filter((p) => p.app === app.slug);
  if (!list.length) return;
  const canonical = abs(`/apps/${app.slug}/`);
  const body = `<section class="hero">
<p class="eyebrow">${esc(app.type || "앱")} · ${esc(app.status || "")}</p>
<h1>${esc(app.name)}</h1>
<p>${esc(app.summary || app.tagline || "")}</p>
</section>
<section class="list"><p class="crumb"><a href="/">홈</a> · ${esc(app.name)} 글 ${list.length}개</p>${list.map(postCard).join("")}</section>`;
  const ld = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: `${app.name} — 개발 블로그`,
    url: canonical, description: app.summary || app.tagline || "", inLanguage: cfg.lang,
  };
  write(`apps/${app.slug}/index.html`, layout({
    title: `${app.name} 개발 블로그 — ${cfg.brand}`, description: app.summary || app.tagline || cfg.description,
    canonical, headExtra: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`, body,
  }));
}

function renderSitemap() {
  const urls = [{ loc: cfg.base + "/", lastmod: posts[0]?.updated }];
  for (const a of appsReg) if (posts.some((p) => p.app === a.slug)) {
    const last = posts.filter((p) => p.app === a.slug)[0];
    urls.push({ loc: abs(`/apps/${a.slug}/`), lastmod: last.updated });
  }
  for (const p of posts) urls.push({ loc: abs(p.url), lastmod: p.updated });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  write("sitemap.xml", xml);
}

function renderFeed() {
  const items = posts.slice(0, cfg.postsPerFeed).map((p) => `<item>
<title>${esc(p.title)}</title>
<link>${abs(p.url)}</link>
<guid isPermaLink="true">${abs(p.url)}</guid>
<pubDate>${rfc822(p.date)}</pubDate>
<description>${esc(p.description || "")}</description>
</item>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(cfg.brand)}</title>
<link>${cfg.base}/</link>
<description>${esc(cfg.description)}</description>
<language>${cfg.lang}</language>
${items}
</channel></rss>`;
  write("feed.xml", xml);
}

function render404() {
  write("404.html", layout({
    title: `페이지를 찾을 수 없습니다 — ${cfg.brand}`, description: cfg.description, canonical: cfg.base + "/404.html",
    headExtra: `<meta name="robots" content="noindex">`,
    body: `<section class="hero"><p class="eyebrow">404</p><h1>페이지를 찾을 수 없습니다.</h1><p><a class="chip" href="/">홈으로</a></p></section>`,
  }));
}

// ---------- build ----------
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
copyDir(path.join(ROOT, "assets"), path.join(SITE, "assets"));
posts.forEach(renderPost);
appsReg.forEach(renderAppArchive);
renderHome();
renderSitemap();
renderFeed();
render404();
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${cfg.base}/sitemap.xml\n`);
write("CNAME", cfg.cname + "\n");
write("llms.txt", `# ${cfg.brand}\n${cfg.description}\n${cfg.base}\n`);

console.log(`✓ 빌드 완료 — 글 ${posts.length}개, 앱 ${appsReg.length}개 → site/`);
