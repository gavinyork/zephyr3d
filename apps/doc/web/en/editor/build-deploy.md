# Build & Deployment

The current version of Zephyr3D supports **one-click packaging of your project into a deployable Web page**, which can be used for local preview or uploaded to any static website hosting service (such as GitHub Pages, a self-hosted Nginx server, etc.).

---

## One-Click Web Build

### Steps

1. In the editor menu, click **Build Project**;
2. The editor will automatically build the current project and generate:
   - An `index.html` file that can be opened directly in a browser;
   - All required runtime scripts and asset files (such as JavaScript, WASM, textures, models, audio, etc.);
3. After the build is complete, the editor will provide a **Zip archive** for download:
   - The Zip contains `index.html` and all its dependencies;
   - After extracting, you can use the files locally or on a server.

### Compressed Assets

Textures and meshes set for compression (see [Asset Compression](en/editor/asset-compression.md)) are shipped as their compressed copies, under content-hashed names such as `rock.1a2b3c4d.ktx2`; their source files are left out. Assets that are not compressed are shipped as they are. Compressed copies that are still missing are produced during the build, so a build may take a while the first time.

The build also writes `asset-manifest.json` to the output root. It maps each source path to the file shipped for it, and the engine reads it at startup, so scenes and scripts keep using the original paths. The runtime decoders these files need (the KTX2 transcoder and the Draco decoder) are included automatically.

When the build finishes, a report shows how many textures and meshes were compressed, the download size before and after, and the GPU memory saved; per-asset details are written to the console. An asset that fails to compress is shipped as its source file and flagged in the report.

### Deployment (Quick Overview)

- **Local preview**:
  - Extract the downloaded Zip;
  - Use any local static file server (such as `http-server`, `live-server`, etc.) to serve the directory;
  - Open the corresponding URL in your browser to run the project.

- **Deploying online**:
  - Upload all extracted files to any static hosting environment, for example:
    - Nginx/Apache static directory;
    - GitHub Pages / GitLab Pages;
    - Object storage static website hosting such as S3 + CloudFront, etc.;
  - As long as `index.html` is directly accessible, the application can be opened and run in the browser.

---

## Limitations & Planned Improvements

The build & deployment feature is still evolving. Known and planned improvement areas include (but are not limited to):

1. **Limited build configuration options**
   - Currently, there is no fine-grained build configuration inside the editor, such as:
     - Enabling/disabling code minification or obfuscation;
     - Switching between development and production builds (Debug/Release);
     - Customizing the output directory structure, etc.
   - A future “Build Settings” panel is planned to let users adjust build strategies for different release scenarios.

2. **Limited environment and platform presets**
   - The current build pipeline primarily targets generic Web environments;
   - Texture formats need no per-platform choice: compressed textures are transcoded on each device at load time (see [Asset Compression](en/editor/asset-compression.md));
   - There are no presets yet for specific targets (such as low-end devices), for example project-wide compression levels or multi-resolution asset switching.

3. **Build logs and error messages are not very detailed**
   - When a build fails, or when some assets are not packaged correctly, the error feedback can be quite minimal;
   - Future improvements may include:
     - A dedicated build log panel;
     - More explicit error types and locations (for example, indicating which script or asset caused the build to fail).


