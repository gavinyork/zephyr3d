# Zephyr3D Editor Desktop

This Electron shell is an additive desktop runtime for the existing browser editor.

- Browser builds keep using IndexedDB through `IndexedDBFS`.
- Desktop builds expose a constrained preload bridge at `window.zephyrEditorDesktop`.
- In desktop mode, editor metadata, system plugins, and projects are stored under Electron `app.getPath('userData')/editor-storage`.
- Renderer code still talks to the existing `VFS` abstraction, so editor features do not need direct Node access.

Development:

```sh
npm run build --prefix utility/editor
npm run electron:start --prefix utility/editor
```

Packaging:

```sh
npm run electron:dist --prefix utility/editor
```
