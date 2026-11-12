# alepax.com

Personal site of Alex Pintea: AI engineering, Blender, Three.js.

## Preview

```sh
python -m http.server 8080
```

Then open http://localhost:8080/

## Structure

- `index.html` - the landing page
- `assets/css/site.css` - styles
- `assets/js/site.js` - main script
- `assets/js/hero-scene.js` - lazy-loaded Three.js chunk for the hero
- `assets/js/graph-layout.js` - pure layout functions shared by the SVG poster and the scene
- `data/nodes.json` - nodes of the hero site graph (project and log entries); `site.config.json` sets `graph.maxNodes`
- `vendor/three.module.min.js` - Three.js, pinned to 0.170.0
- `assets/img/` - images and icons
- `archive/` - legacy pages, marked noindex and disallowed in `robots.txt`
- `scripts/check-no-business.mjs` - repository guard (see below)

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
segment in any shipped path.

## Deploy

- GitHub Pages user site, published from branch `main`.
- `CNAME` holds the custom domain and must stay.
- `.nojekyll` disables Jekyll processing.
- OpenHorizon is a separate repository, served at `/OpenHorizon/` by GitHub Pages.
  Nothing with that name may be added to this repository.
- To publish, merge `v1-site` into `main`.

## Licence

Not yet decided. There is no LICENSE file.

© Alex Pintea, all rights reserved. Third-party notices live in `/vendor/`.
