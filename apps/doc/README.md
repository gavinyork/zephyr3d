# Documentation site for zephyr3d.

## Development

Run `npm run dev` to start VitePress together with the lazy tutorial and showcase watchers.
Changes to markdown, tutorial source, generated demo assets, and `web/js/showcase.js` trigger an
incremental rebuild and browser reload. Tutorial bundles are built in short-lived Rollup processes,
so starting the site does not keep every example's dependency graph in memory. Use
`npm run dev:vitepress` when only the markdown site is needed. Set `SITE_TUT` to a semicolon-separated
list (for example, `tut-70`) when focusing on a small set of tutorials or when tutorial output has
not been generated yet.
