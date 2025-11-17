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
const scene = await engine.serializationManager.loadScene('/scenes/demo.json');
const texData = await engine.VFS.readFile('/textures/stone.png');
```

When saving or serializing scenes, the engine’s `SerializationManager` uses VFS for I/O as well:

```typescript
await this._vfs.writeFile(filename, JSON.stringify(content), { encoding: 'utf8', create: true });
```

Thus, both reading and writing are fully abstracted from the underlying storage system.

---

## Extensibility of VFS

Zephyr3D’s VFS layer allows developers to define their own custom file systems by extending `VFS` and implementing its abstract methods (e.g. `_readFile`, `_writeFile`, `_stat`).  
This makes it possible to plug in any kind of file management logic directly into the engine.

**Typical customization scenarios include:**

| Use Case | Example |
|-----------|----------|
| **Local caching layer** | Implement a local cache before falling back to HttpFS |
| **Encrypted assets** | Add encryption/decryption logic in `_readFile` and `_writeFile` |
| **Version-controlled resources** | Use a custom URL resolver to append version tags |
| **Archive-based loading** | Create a `ZipFS` to access resources from packaged archives |
| **Offline access** | Use `MemoryFS` or `IndexedDBFS` for persistent offline storage |

---

## Example: Custom Cached File System

```typescript
import { VFS, VFSError } from '@zephyr3d/base';

class CachedHttpFS extends VFS {
  constructor(private httpfs) {
    super();
  }

  private cache = new Map<string, ArrayBuffer>();

  async _readFile(path) {
    if (this.cache.has(path)) {
      return this.cache.get(path);
    }
    const data = await this.httpfs.readFile(path, { encoding: 'binary' });
    this.cache.set(path, data);
    return data;
  }

  async _writeFile() {
    throw new VFSError('Read-only', 'EROFS');
  }

  async _exists(path) {
    return this.cache.has(path) || this.httpfs.exists(path);
  }
  // Other abstract methods can be overridden or left unimplemented as needed
}
```

Usage:

```typescript
const cachedFS = new CachedHttpFS(new HttpFS('./cdn'));
const app = new Application({ backend, canvas, runtimeOptions: { VFS: cachedFS } });
```

This approach allows flexible caching at the VFS level while maintaining full engine compatibility.

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
