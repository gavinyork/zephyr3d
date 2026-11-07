# Editor Interface

The Zephyr3d Editor interface is organized from top to bottom as follows:

- **Main Menu** – The top menu bar, providing access to all features  
- **Toolbar** – Shortcut buttons for commonly used tools  
- **Workspace** – The main editing area  
- **Status Bar** (bottom) – Displays status information  

The workspace is divided into four main areas:

| Area                           | Description                               |
|-------------------------------|-------------------------------------------|
| **Scene Hierarchy** (left)    | Shows the hierarchical structure of the scene |
| **Viewport** (center)         | 3D view and scene editing                 |
| **Inspector** (right)         | Edit properties; the Scripts section at the bottom attaches scripts |
| **Content Browser / Log View** (bottom) | Manage assets and view logs; the desktop build adds an **Assistant** tab |

Plugins can add their own panels to the left, right and bottom areas.

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-workspace.jpg" width="1024">

### Viewport Navigation

| Action | Effect |
|------|------|
| Right-drag | Turn the view in place |
| Hold right button + `W` `A` `S` `D` | Fly forward, back, left, right |
| Hold right button + `Q` / `E` | Move down / up |
| `Alt` + left-drag | Orbit around the view centre |
| `Alt` + middle-drag | Pan the view |
| `Alt` + right-drag | Dolly in / out |
| Scroll wheel | Dolly in / out; hold `Ctrl` for 10× speed, `Shift` for 0.1× |

### Keyboard Shortcuts

| Shortcut | Effect |
|------|------|
| `Q` | Select tool |
| `W` | Move tool |
| `E` | Rotate tool |
| `R` | Scale tool |
| `F` | Frame the selected object in the view |
| `Delete` | Delete the selected nodes |
| `Ctrl + D` | Duplicate whatever has focus: scene nodes, assets or blueprint nodes |
| `Ctrl + C` / `Ctrl + V` | Copy / paste |
| `Ctrl + Z` / `Ctrl + Y` | Undo / redo |
| `Ctrl + N` | New scene |
| `Ctrl + O` | Open scene |
| `Ctrl + S` | Save scene |
| `Ctrl + Alt + S` | Save scene as |
| `F2` | Rename the selected asset |
| `F12` | Toggle developer tools (desktop only) |
