# Documentation site for zephyr3d.

## Development

Run `npm run dev` to start VitePress together with the lazy tutorial and showcase watchers.
Changes to markdown, tutorial source, generated demo assets, and `web/js/showcase.js` trigger an
incremental rebuild and browser reload. Tutorial bundles are built in short-lived Rollup processes,
so starting the site does not keep every example's dependency graph in memory. Use
`npm run dev:vitepress` when only the markdown site is needed. Set `SITE_TUT` to a semicolon-separated
list (for example, `tut-70`) when focusing on a small set of tutorials or when tutorial output has
not been generated yet.

## How the examples are built

The engine is **not** inlined into each example. `rollup.config.libs.mjs` bundles every
`@zephyr3d/*` package into one ES module under `web/public/tut/lib/`, and
`rollup.config.mjs` builds each example with those packages marked external, rewriting
`@zephyr3d/scene` to `../lib/zephyr3d-scene.js`. So an example bundle contains only its own
code plus any third-party dependency it imports directly, and the browser downloads and
caches the engine once for all of them.

Two consequences worth knowing:

- **Changing engine code does not rebuild the examples.** Run `npm run build:libs` (or
  `build:tutorials`, which runs it first) to refresh `tut/lib`. `npm run dev` watches
  `libs/*/dist` and rebuilds only those bundles.
- Because the engine bundles are built from `libs/*/dist`, an engine source edit shows up
  only after that package's own build has emitted new `dist` output.

Both steps keep a content-hash cache (`.buildcache.json` for examples, `.libcache.json` for
the engine) and skip work that is already current. `npm run clean:cache` forces a full
rebuild.
