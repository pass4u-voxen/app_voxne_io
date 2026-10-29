# app.voxen.io — VOXEN 앱·게임 개발 블로그

VOXEN이 만드는 앱·게임의 개발기를 올리는 정적 블로그. 마크다운 → 정적 HTML(Search Console 최적화) → GitHub Pages 자동 배포.

## 매일 글 올리기

1. `content/posts/YYYY-MM-DD-슬러그.md` 파일 추가 (아래 양식)
2. `git add . && git commit -m "글: ..." && git push`
3. GitHub Actions가 빌드·배포 → 몇 분 뒤 `https://app.voxen.io/슬러그/` 라이브. sitemap이 갱신돼 Google이 자동 재크롤.

### 글 양식 (frontmatter)

```markdown
---
title: 글 제목
app: paintrip          # content/apps.json의 앱 slug (없으면 생략)
date: 2026-11-01
updated: 2026-11-01    # 수정하면 갱신 (sitemap lastmod에 반영)
tags: [개발기]
description: 검색결과·OG에 나올 한 줄 요약 (필수 권장)
cover:                 # OG 이미지 경로 (없으면 기본 이미지)
draft: false           # true면 발행 안 됨
---

본문 (마크다운). ## 소제목, 목록, `코드`, > 인용 등 지원.
```

URL은 파일명의 날짜를 뺀 `슬러그` → `app.voxen.io/슬러그/`. frontmatter `slug:`로 직접 지정도 가능.

## 새 앱 등록

`content/apps.json`의 `apps` 배열에 추가(slug·name·type·summary 등). 해당 앱 글이 1개 이상이면 `app.voxen.io/apps/<slug>/` 아카이브가 자동 생성됨.

## 로컬 미리보기

```bash
npm install
npm run build          # → site/
npm run serve          # http://localhost:8787
```

## SEO (생성기에 내장)

- 포스트별 고유 title·description·canonical·OG·Twitter 카드
- `BlogPosting` + `BreadcrumbList` JSON-LD, 홈 `Blog`, 앱 `CollectionPage` 스키마
- `sitemap.xml`(lastmod) · `feed.xml`(RSS) · `robots.txt`
- Google Search Console 소유권 메타태그 **모든 페이지에 내장**(config.json `googleSiteVerification`) → 재빌드해도 인증 유지

## 배포·도메인

- GitHub Pages(Actions: `.github/workflows/pages.yml`), 커스텀 도메인 `app.voxen.io`(생성기가 `site/CNAME` 생성)
- DNS: Cloudflare에서 `app` → `pass4u-voxen.github.io` CNAME (또는 Pages IP A레코드)
