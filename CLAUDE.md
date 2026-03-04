# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zephyr3D is a TypeScript-based 3D rendering engine for the web with unified WebGL/WebGPU backends and a code-generated shader system. The project is a Rush monorepo using pnpm.

## Development Commands

### Installation & Setup
```bash
rush install          # Install dependencies (first time or after pulling changes)
rush update           # Update dependencies and shrinkwrap
```

### Building
```bash
rush build            # Incremental build of all projects (parallel)
rush rebuild          # Clean and rebuild all projects
rush build:check      # TypeScript type checking without emitting files
rush build --to <pkg> # Build only dependencies needed for <pkg>
```

### Code Quality
```bash
rush lint             # Lint all projects
rush lint-fix         # Lint and auto-fix issues
rush prettier         # Format staged changes (used by pre-commit hook)
```

### Testing
```bash
rush test             # Run Jest tests in ./test directory
```

### Cleaning
```bash
rush clean            # Remove all dist/ directories
```

## Architecture

### Package Dependency Hierarchy
```
@zephyr3d/base (foundation)
  └─ @zephyr3d/device (RHI + shader builder)
      ├─ @zephyr3d/backend-webgl
      ├─ @zephyr3d/backend-webgpu
      └─ @zephyr3d/scene (scene system)
          └─ @zephyr3d/imgui
```

### Core Packages

- **base** (`libs/base/`) - Foundation layer: math utilities, VFS, events, SmartPtr
- **device** (`libs/device/`) - RHI (Rendering Hardware Interface) abstraction layer and shader builder system
- **backend-webgl** (`libs/backend-webgl/`) - WebGL 1/2 backend implementation
- **backend-webgpu** (`libs/backend-webgpu/`) - WebGPU backend implementation
- **scene** (`libs/scene/`) - High-level scene system with subsystems:
  - `animation/` - Animation system
  - `camera/` - Camera controllers
  - `material/` - Material system
  - `posteffect/` - Post-processing effects
  - `render/` - Rendering pipeline
  - `shadow/` - Shadow mapping
  - `shapes/` - Geometric primitives
  - `shaders/` - Built-in shaders
- **imgui** (`libs/imgui/`) - ImGui integration for debug UI
- **editor** (`utility/editor/`) - Web-based visual editor
- **examples** (`examples/`) - Example applications
- **test** (`test/`) - Test suite using Jest

### Shader Builder System

The shader builder (`device/src/builder/`) is a core architectural feature that allows writing shaders in JavaScript/TypeScript and generates backend-specific code:

- Single JS/TS source generates GLSL (WebGL 1/2) and WGSL (WebGPU)
- Automatically handles uniform buffer layouts, bind groups, and attribute bindings
- Type-safe shader construction with IDE support
- See `device/src/builder/programbuilder.ts` for the main API

Example shader definition:
```typescript
const program = device.buildRenderProgram({
  vertex(pb) {
    this.$inputs.pos = pb.vec3().attrib('position');
    pb.main(function() {
      this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
    });
  },
  fragment(pb) {
    this.$outputs.color = pb.vec4();
    pb.main(function() {
      this.$outputs.color = pb.vec4(1, 0, 0, 1);
    });
  }
});
```

## Build System Details

- **Bundler**: Rollup (configured in each package's `rollup.config.mjs`)
- **Transpiler**: SWC (fast TypeScript/JavaScript transpilation)
- **Type Checking**: TypeScript 5.7.3
- **Linting**: ESLint 9.38.0 with TypeScript plugin
- **Testing**: Jest 30.x with ts-jest
- **Formatting**: Prettier 3.6.2
- **Package Manager**: pnpm 10.23.0
- **Node Version**: >= 20.0.0

## Working with Individual Packages

Each package has standard npm scripts:
```bash
cd libs/device
npm run build         # Build this package only
npm run build:check   # Type check only
npm run lint          # Lint this package
npm run lint-fix      # Lint and fix
npm run clean         # Clean build output
```

However, prefer using `rush` commands from the root to ensure proper dependency ordering.

## Internal Dependencies

Packages use the `workspace:` protocol for internal dependencies (e.g., `"@zephyr3d/base": "workspace:^0.2.1"`). Rush automatically links these during `rush install`.

## Publishing

Six packages are published to npm:
- @zephyr3d/base
- @zephyr3d/device
- @zephyr3d/scene
- @zephyr3d/imgui
- @zephyr3d/backend-webgl
- @zephyr3d/backend-webgpu

## Key Files

- `rush.json` - Monorepo configuration and project registry
- `common/config/rush/command-line.json` - Custom Rush commands
- `common/config/rush/pnpm-lock.yaml` - Dependency lockfile
- `tsconfig.json` - Root TypeScript configuration
- `tsconfig.common.json` - Shared TypeScript settings
