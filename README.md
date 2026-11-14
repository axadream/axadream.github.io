# alepax.com

Personal site of Alex Pintea: AI engineering, Blender, Three.js.

## Preview

```sh
python -m http.server 8080
```

Then open http://localhost:8080/

## Debugging motion

- Add `?motion=force` on localhost or 127.0.0.1 to run the hero graph even when
  prefers-reduced-motion is set. Ignored on any other host. `?motion=reduce` on the
  same hosts forces the reduced-motion path for testing.
- The same override exposes `window.__graph` with `positions()`, `energy()` and `fps()`.
  It is removed when the scene is disposed.
- Ambient float amplitude, period range and depth wobble are the `AMBIENT_*` constants
  in the `K` block of `graph-scene.js`.

## Structure

- `index.html` - the landing page
- `assets/css/site.css` - styles
- `assets/js/site.js` - main script
- `assets/js/graph-scene.js` - lazy-loaded Three.js chunk for the hero graph
- `assets/js/graph-layout.js` - pure layout functions shared by the SVG poster and the scene
- `data/nodes.json` - nodes of the hero site graph, see below; `site.config.json` sets `graph.maxNodes`
- `vendor/three.module.min.js` - Three.js, pinned to 0.170.0
- `assets/img/` - images and icons
- `archive/` - legacy pages, marked noindex and disallowed in `robots.txt`
- `scripts/check-no-business.mjs` - repository guard (see below)

## nodes.json

One object per node: `id`, `type` (`project` or `log`), `label`, `url`.

- Project: `status` is `released` or `planned`. A released project has `updated` (ISO date, replaces `date`); a planned project has no date and renders as a dim hollow ring labelled `(planned)`. Optional `title` is the short name shown in the graph label.
- Log: `date` (ISO). The label's text before ` · ` is the short name.
- `Last update` counts log dates and released projects' `updated` only; node colour tiers (new <= 7 days, recent <= 30, older) follow the same dates.
- Motion constants live in the `K` block at the top of `graph-scene.js`. Node positions are never stored.

## How to add a log entry

Edit the rows between `<!-- log:start -->` and `<!-- log:end -->` in `index.html`.
Keep the latest three entries, newest first. Use the same row markup and a
`<time datetime>` element for the date, copied from the existing rows.
The full archive and the generator arrive in Phase 2.

## Reserved sections

- 3D work: find `<!-- reserved: 3d-work -->` in `index.html` and add a `<section>`
  using the same `.card` markup as the projects.
- Lab: find `<!-- reserved: lab -->` in `index.html` and add a `<section>` using
  the same `.card` markup. Add a nav link in the header for either section.
- The Lab is deliberately empty until there is a first item.

## Guard

Run before every commit:

```sh
node scripts/check-no-business.mjs
```

It fails on commercial and advertising terms, and on the reserved sub-project
segment in any shipped path. It also reports gzipped first-party JS against a 12 KB budget.

### Tests

- `node tests/graph-regression.mjs` is a Playwright run and is not part of the deployed site.
- It resolves Playwright from `import('playwright')` or the npx cache. First run once:
  `npx --yes playwright@1.48.2 install chromium`.
- It falls back to an installed Chrome or Edge when no bundled browser is found.

## Deploy

- GitHub Pages user site, published from branch `main`.
- `CNAME` holds the custom domain and must stay.
- `.nojekyll` disables Jekyll processing.
- OpenHorizon is a separate repository, served at `/OpenHorizon/` by GitHub Pages.
  Nothing with that name may be added to this repository.
- To publish, merge `v1-site` into `main`.

## Versioning

- The version lives in `site.config.json` (`version`), mirrored in the footer `.foot-ver` line of `index.html` and in `CHANGELOG.md`.
- `scripts/check-no-business.mjs` fails if the three disagree, or if `threeDWork` or `lab` is not `false`.
- Release: bump all three, run the guard, commit, then tag `v<version>`.

## Licence

Not yet decided. There is no LICENSE file.

© Alex Pintea, all rights reserved. Third-party notices live in `/vendor/`.
