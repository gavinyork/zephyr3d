# Scene Editing

## Scene Management

**Create a Scene**  
- Menu: `Scene → New Scene`

**Save a Scene**  
- Shortcut: `Ctrl + S`  
- Menu: `Scene → Save Scene`

---

## Creating Objects

Use the **Add** menu in the main menu bar to add objects to the scene:

- Built‑in meshes (Box, Sphere, Plane, Cylinder, etc.)  
- Lights (Directional Light, Point Light, Spot Light)  
- Cameras  
- Terrain  
- Water  
- Particle systems  

You can also drag prefabs (such as models) from the **Content Browser** into the **Viewport** to add them to the scene.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/add-object-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

---

## Editing Transforms

### Move

- Activate: `T` key or the Move tool button on the toolbar  
- Features:
  - Drag an axis to move along a single axis  
  - Drag a plane handle to move freely within that plane  
  - Drag the center cube to perform surface snapping / placement  

### Scale

- Activate: `S` key or the Scale tool button on the toolbar  
- Features:
  - Drag an axis to scale along a single axis  
  - Drag the center cube to scale uniformly  

### Rotate

- Activate: `R` key or the Rotate tool button on the toolbar  
- Features:
  - Drag a rotation ring to rotate around a specific axis  
  - Click empty space to enter trackball‑style free rotation mode  

<video src="https://cdn.zephyr3d.org/doc/assets/videos/transform-object-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

---

## Node Operations

- `Ctrl + D` or the duplicate button on the toolbar – duplicate the selected object  
- `Delete` – delete the currently selected node  

<video src="https://cdn.zephyr3d.org/doc/assets/videos/duplicate-object-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

---

## Editing Properties

When an object is selected in the scene, you can edit its properties in the **Inspector** on the right:

- Transform  
- Visibility  
- Attached scripts  
- Animation settings  

---

## Special Editing Modes

Some node types use dedicated editing tools.  
For example, terrain uses brush tools for sculpting height and painting surface textures.

For such nodes:

1. Select the node.  
2. Click the **Edit** button on the toolbar to enter the special editing mode.  
3. Click the same button again to exit the editing mode.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/edit-object-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>
