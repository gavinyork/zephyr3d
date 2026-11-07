# Virtual File System (VFS)

## Overview

Zephyr3D’s file access system is built upon a highly abstracted **Virtual File System (VFS)** architecture.  
With VFS, all modules — including resource loading, scene serialization, and the scripting system — can access files through a unified interface without worrying about where those files actually reside (local, network, memory, or otherwise).

This design provides Zephyr3D with several key advantages:

- Platform-independent file access  
- Pluggable file system implementations  
- Flexible support for network loading, local caching, and offline execution  
- Extendability via user-defined custom file systems  

---

## Core Structure of VFS

### Abstract Base Class

The abstract base class `VFS`, defined in `vfs.ts`, provides a unified set of asynchronous interfaces for file and directory operations.  

It inherits from `Observable`, enabling file change events (create, delete, modify) and supports mounting or unmounting subordinate file systems.

**Key APIs include:**

| Method | Description |
|--------|-------------|
| `readFile(path, options)` | Reads file content; supports `utf8`, `binary`, and `base64` encodings |
| `writeFile(path, data, options)` | Writes data to a file; supports append and auto-create |
| `exists(path)` | Checks if a file or directory exists |
| `stat(path)` | Retrieves metadata such as size, timestamps, and type |
| `makeDirectory(path, recursive)` | Creates a directory, optionally recursively |
| `readDirectory(path, options)` | Lists directory contents |
| `move(source, target)` | Moves or renames a file/directory |
| `deleteFile(path)` / `deleteDirectory(path)` | Removes a file or directory |
| `mount(path, vfs)` / `unmount(path)` | Mounts or unmounts sub-file systems at a given path |
| `normalizePath(path)` | Normalizes and resolves relative paths |
| `glob(pattern, options)` | Matches files using wildcard patterns |
| `copyFile` / `copyFileEx()` | Copies files across paths or between VFS instances |

---

## VFS Usage Within the Engine

### 1. Integrating with the Application

During application initialization, any VFS implementation can be specified in the `Application` configuration:  
(as defined in `app.ts`)

```typescript
const app = new Application({
  canvas,
  backend,
  runtimeOptions: {
    VFS: new HttpFS('.') // Default file system source, using the current page path as base
  }
});
```

Once set, all file and resource operations within Zephyr3D — including textures, shaders, and scenes — are routed through the provided `VFS` instance.

---

### 2. Resource and Scene Loading Flow

In the engine, all serialization and resource loading operations rely on VFS:

```typescript
// Engine.loadSceneFromFile() is the entry point for loading a scene. It shares one
// promise across concurrent requests for the same path and attaches declared scripts
// once the scene is loaded; a call after the load has finished reads the file again
// and returns a new scene.
const scene = await engine.loadSceneFromFile('/scenes/demo.zscn');
const texData = await engine.VFS.readFile('/textures/stone.png');
```

Internally it delegates to `engine.resourceManager.loadScene()`. Saving a scene goes through the active VFS too:

```typescript
await engine.resourceManager.saveScene(scene, '/scenes/demo.zscn');
```

The default `HttpFS` is read-only, so saving to it throws an `EROFS` error; to save, use or mount a writable file system (see below).

Thus, both reading and writing are fully abstracted from the underlying storage system.

---

## Built-in File Systems

`@zephyr3d/base` ships these file systems, so most needs do not call for a custom one:

| Class | Access | Use |
|------|------|------|
| `HttpFS` | read-only | Reads over HTTP; writes throw `EROFS`. The `urlResolver` option rewrites request URLs (for example to add a version); `readDirectory` / `glob` on it need the `directoryReader` option |
| `MemoryFS` | read-write | Keeps data in memory; it is lost when the page closes |
| `IndexedDBFS` | read-write | Keeps data in the browser's IndexedDB, persistently; suits offline and editor-like workflows |
| `ZipFS` | read-write | Reads and writes files in a zip archive; needs zip.js passed in |
| `DataTransferVFS` | read-only | Files or folders dropped onto the page, or picked with `<input type="file">` |
| `NullVFS` | — | An empty file system |

They can be combined by mounting (see below).

## Custom File Systems

When you do have special needs (encrypted assets, a custom cache), extend an existing file system and override only what changes. Extending `VFS` directly means implementing every abstract method (`_readFile`, `_writeFile`, `_stat`, `_readDirectory` and about ten more), which is far more work.

## Example: HttpFS with an In-Memory Cache

```typescript
import { HttpFS, type ReadOptions } from '@zephyr3d/base';

// Only reading is overridden; read-only behaviour, directory reading and the rest come from HttpFS
class CachedHttpFS extends HttpFS {
  private cache = new Map<string, Promise<ArrayBuffer | string>>();

  protected _readFile(path: string, options?: ReadOptions) {
    // The engine reads scenes and prefabs as utf8 and textures as binary;
    // the encoding and the read range belong in the cache key
    const key = `${path}|${options?.encoding ?? 'binary'}|${options?.offset ?? ''}|${options?.length ?? ''}`;
    let data = this.cache.get(key);
    if (!data) {
      data = super._readFile(path, options);
      data.catch(() => this.cache.delete(key)); // do not cache failed requests
      this.cache.set(key, data);
    }
    return data;
  }
}
```

To use it:

```typescript
const cachedFS = new CachedHttpFS('./cdn');
const app = new Application({ backend, canvas, runtimeOptions: { VFS: cachedFS } });
```

Always pass `options` on when overriding reads: ignoring `encoding` and always returning binary data makes the engine fail when it parses scene files as text.

---

## Mounting and Combining File Systems

`VFS` supports hierarchical composition by mounting other file systems at specific paths:

```typescript
const rootFS = new HttpFS('./');
const memoryFS = new MemoryFS();

await rootFS.mount('/assets/@cache', memoryFS);
await rootFS.mount('/assets/@remote', new HttpFS('https://cdn.example.com'));

// Path mapping after mounting:
// /assets/@cache  -> MemoryFS
// /assets/@remote -> HttpFS (CDN)

// VFS automatically resolves paths based on mount points
await rootFS.readFile('/assets/@remote/texture.png');
```

This allows resource mapping and multi-layer file routing, enabling advanced structures such as mirrors, overlays, or layered caching.

---

## Summary

Zephyr3D’s **Virtual File System (VFS)** provides a unified and extensible resource access framework for the engine:

- `VFS` defines a consistent asynchronous file I/O interface;  
- The default implementation, `HttpFS`, handles standard network file access;  
- The engine, serialization manager, and scripting system all rely on VFS;  
- File systems can be mounted and combined for advanced caching or offline strategies;  
- Developers can easily extend VFS to build custom storage backends.

Through this architecture, resource access in Zephyr3D becomes **platform-independent**, highly **modular**, and easily **tailored** to project-specific asset management or deployment workflows.
