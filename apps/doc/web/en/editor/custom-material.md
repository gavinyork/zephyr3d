# Custom Materials

## Creating a Custom Material

1. In the **Content Browser**, right‑click and choose `Create New → Material`.  
2. In the material blueprint editor, add nodes and connect them to the output.  
3. Use the preview window to check the material result.  
4. Click `Save` to generate both the `.zmtl` material file and its `.zbpt` blueprint file.  
5. In the scene, select a Mesh object, then drag the `.zmtl` file from the Content Browser onto the material field in the **Inspector** to apply the material.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/create-material.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

---

## Creating a Material Instance

In the **Content Browser**, right‑click a material and choose **Create Material Instance** to create a new instance from it.  
Material instances share the same blueprint (if the base material is blueprint‑based) but can use different `uniform` parameter values.

---

## Editing Custom Materials

Double‑click a `.zmtl` file in the **Content Browser** to edit that material:

- If it is a **blueprint material**, the blueprint editor will open.  
- If it is a **non‑blueprint material** (for example, an instance created from a built‑in material under the `@builtins` directory), you can only edit its material properties, not the underlying blueprint.
