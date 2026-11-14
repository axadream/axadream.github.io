# Changelog

All notable changes to this site are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-12

### Fixed

- Graph went dead after back/forward-cache restore: `pagehide` now pauses when the page is persisted and disposes otherwise; `pageshow` resumes, or rebuilds on a fresh canvas when the WebGL context was lost.
- WebGL context lost and restored events are handled.
- Pointer drag state is reset on `pointercancel`, `blur`, hidden tab and `pageshow`.
- Reduced-motion energy reading fixed.

### Changed

- The guard reports gzipped first-party JS (site, graph layout and scene, plus the inline head script) and fails above 12 KB; the raw total is a warning above 24 KB.
- Added `tests/graph-regression.mjs`, a Playwright regression run with `node tests/graph-regression.mjs`.
- Added the `?motion=reduce` localhost debug variant.

## [1.0.0] - 2026-11-12

### Added

- Single-page portfolio: hero, AI projects, log and footer.
- Interactive site graph in the hero (Three.js, lazy-loaded), with nodes from `data/nodes.json`, hover, drag and click, a keyboard site map, and reduced-motion support.
- Dark and light theme toggle, and self-hosted Space Grotesk headings.
- SEO: canonical URL, Open Graph, JSON-LD, sitemap, robots.txt and a 404 page.
- Accessibility: skip link, landmarks, visible focus rings and text contrast of at least 4.5:1.
- Guard script that fails the build on commercial content and checks version agreement.
- Legacy pages archived under `/archive/` with noindex.
