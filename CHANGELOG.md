# Changelog

All notable changes to this site are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-11-16

### Added

- Drift test: one fixture is rejected by both the guard and `tools/log-post/post.mjs`, so the proof rule cannot diverge between schema, guard and poster.

### Changed

- Guard: posts with `made` = AI-guided or Mixed fail the build without a `proof` URL. Manual stays optional.
- CMS hint on the Proof field states the same rule (the field stays `required: false`).
- Five AI-guided posts gained a `proof` link to the pull request that shipped the work.
## [1.8.0] - 2026-11-16

### Added

- Per-page Open Graph and Twitter tags, with four generated share images (`node scripts/make-og.mjs`, each <= 60 KB) that replace the 181 KB og.png
- Blog JSON-LD for the ten newest log entries
- Atom feed at `/feed.xml`, linked from every page
- Sharing tests (`tests/sharing.test.mjs`)

### Fixed

- A double Reload during one rebuild is ignored

### Removed

- `lighthouse-budget.json`; `.lighthouserc.json` is the single source of the 150 KB limit
- `og.png`

## [1.7.0] - 2026-11-16

### Added

- Lighthouse CI with budgets (performance >= 0.90, accessibility = 1, best-practices >= 0.95, seo = 1, home page <= 150 KB before any click); a failing assertion blocks deploy

### Fixed

- Version check now reads the footer of every generated page
- Reload is disabled during the first in-flight load

## [1.6.1] - 2026-11-16

### Fixed

- Graph drift appeared to be missing on desktops with Windows animation effects off; the graph now explains that motion is reduced by the system setting (drag still works)

## [1.6.0] - 2026-11-16

### Changed

- About page design and text; hero two-column layout restored; Play/Running/Reload button states

## [1.5.0] - 2026-11-16

### Added

- /about/ page built from content/about.md

### Changed

- Proof-first home order
- 3 home log entries
- Play-the-graph button above the poster

## [1.3.0] - 2026-11-16

### Changed

- Hero graph loads only on click of `#graph-play`; no graph chunk or `three.module` is requested before the user acts.
- Budget rule restated: per-page first-party gzipped JS <= 12,288 B, and no chunk may load without a user action.
- Guard: new `user-action load` check fails the build if `index.html` references a lazy chunk, or if `assets/js/site.js` references one without the `/* user-action-load */` marker.

## [1.2.1] - 2026-11-16

### Added

- `handbook_base` set to the live AI Engineering Handbook; log card IDs link to `#<id>`.
- "Handbook" button in Start-here; home line pointing to `/log/` for labels and all entries.

## [1.2.0] - 2026-11-15

### Added

- Log schema v2 fields: `made`, `track`, `cards`, `proof`, `trace`.
- `handbook_base` site config key.
- Log legend and a Start-here block.
- Made badges and track colours; graph nodes are coloured by track.

### Changed

- `link` is renamed `proof` and restricted to github.com/axadream/ and alepax.com/ links.
- CMS and log-post tool updated for schema v2.
- build-log fails the build on front-matter parse errors and invalid entries.

### Removed

- `tag` and `project` fields.

### Notes

- Accepted deviations: the poster keeps tier colours (no `tr-<track>` class); the log-to-project edge in `graph-layout.js` is now inert; `nodes.json` stores track slugs `app`, `ai-study`, `math`, `3d`; recency on log nodes is now only the <=7-day halo, since colour comes from track.

## [1.1.4] - 2026-11-14

### Fixed

- CMS empty optional fields (link/project `''`) no longer fail validation; posts saved via /admin/ now publish.

## [1.1.3] - 2026-11-14

### Fixed

- Graph: node drift is independent of the throttled frame loop and clamped to the graph area.
- Graph: touch drag enabled; a dragged node stays where it is released; with reduced motion drift is off but drag still works.

### Changed

- README: guard WARN/--strict policy.
## [1.1.2] - 2026-11-14

### Changed

- Guard: stale generated outputs after markdown-only post commits are a WARN by default; `--strict` fails them (CI still rebuilds and checks). Regenerated log build outputs.

## [1.1.1] - 2026-11-12

### Added

- Claude Code skill `log-post` in `tools/log-post/`: `post.mjs` (preview, explicit yes, idempotent Contents API PUT to `content/log/` on `main`, pending queue with `--flush`, `--dry` mode), `SKILL.md`, and an installer `install.ps1` that copies the skill to `~/.claude/skills/log-post` and creates `~/.alepax-log/` outside any repository.
- Tests for the skill, including a check that its schema copy equals `schema/`.
- README section "Logging from Claude Code (skill `log-post`)".

## [1.1.0] - 2026-11-12

### Added

- Practice log entries as Markdown files in `content/log/`, with a JSON schema in `schema/`.
- `scripts/build-log.mjs` generates the home page's 12 newest entries, the `/log/` archive, `data/nodes.json`, and the generated site map. `--check` fails if outputs are stale.
- GitHub Actions Pages workflow with pinned action SHAs and least-privilege permissions.
- Self-hosted Sveltia CMS 0.265.0 at `/admin/`, with a Content Security Policy.
- Guard checks 6-8: log entry validation, build freshness, and the admin host allowlist.
- `node:test` suite under `tests/`.

### Changed

- Log rows drop the status column. Entries Ep 1-9 are migrated as "Manual Code".
- Graph `maxNodes` is 14.
- The sitemap includes `/log/`.

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
