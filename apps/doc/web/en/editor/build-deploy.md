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
   - There are no one-click optimization presets yet for specific targets (such as mobile Web, low-end devices), for example:
     - Different asset compression levels;
     - Texture format selection per platform;
     - Multi-resolution asset switching strategies.

3. **Build logs and error messages are not very detailed**
   - When a build fails, or when some assets are not packaged correctly, the error feedback can be quite minimal;
   - Future improvements may include:
     - A dedicated build log panel;
     - More explicit error types and locations (for example, indicating which script or asset caused the build to fail).


