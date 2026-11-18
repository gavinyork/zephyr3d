# Foliage Tools

A foliage node scatters trees, bushes and rocks over a terrain. You paint **where** things grow and how densely; each layer's generation rule turns that into instances. For the concepts and the runtime API, see [Foliage](en/foliage.md).

---

## Creating a foliage node

- Choose `Add → Foliage` in the main menu and place it on the terrain. The foliage node must sit under the terrain: instances take their height from it and follow it when it is reshaped.
- In the Properties panel, add an entry to the `Layers` list for each kind of object, and set its `Asset` by dragging a prefab or model (`.zprefab`, `.glb`, `.gltf`, `.fbx`, `.obj`) from the content browser.

---

## Foliage brush

Select the foliage node and click the edit button in the toolbar. The `Foliage Brush` panel opens:

| Control | Effect |
|---|---|
| `Layer` | The layer to paint |
| `Mode` | `Paint` raises the density, `Erase` lowers it. Holding Shift erases while painting |
| `Radius`, `Strength`, `Falloff` | Brush size, how fast density builds up, and how softly it fades toward the edge |
| `Erase placed instances too` | Erasing also removes instances placed by the scatter tool, thinning them out toward the brush edge |
| `Erase every layer` | Erasing clears all layers, for example to clear a path through a mixed forest |
| `Regenerate layer` | Regenerates the whole layer after its generation settings changed |

Drag to paint; `[` and `]` resize the brush. The panel shows how many instances are painted and how many were placed directly.

Painting is stable: painting denser adds trees without moving the ones already there, and erasing then repainting an area brings back the same trees. To get a different arrangement, change `Seed` and regenerate.

---

## Layer settings

**Generation** — how painted copies are laid out:

| Property | Effect |
|---|---|
| `Spacing` | Roughly the closest two copies get, in meters |
| `ScaleRange`, `RandomYaw` | Variation between copies |
| `SlopeRange` | Copies only grow on ground this steep: 0° is flat, 90° a wall |
| `LimitHeight`, `HeightRange` | Copies only grow between two heights, e.g. above the water line |
| `YOffset` | Height above the ground; negative sinks the base in |
| `Surface` | `Terrain` follows the ground; `Any surface` lands copies on whatever has a collider below, rocks and buildings included |
| `PlaceScript` | Optional `function place(p, api, input)` deciding how likely a copy is at each point, the same contract as the scatter tool |

Changing these settings does not move existing instances until the layer is regenerated.

**Drawing:**

| Property | Effect |
|---|---|
| `CullDistance` | Copies farther than this disappear |
| `CastShadow` | Turn off for small plants to save shadow rendering time |
| `AlignToNormal` | 0 stands upright, 1 leans with the slope |
| `FadeDistance` | Copies dither over this many meters instead of popping (WebGPU only) |

**Impostor** — far copies drawn as baked cards:

| Property | Effect |
|---|---|
| `Impostor` | Turns impostors on. The editor bakes them when this is turned on, and again when the asset changes |
| `ImpostorDistance` | Where meshes turn into cards |
| `ImpostorLod` | Level of detail the cards are baked from: pick the level the trees show around the impostor distance |
| `ForceImpostor`, `ImpostorDebug` | Show every copy as a card, or one baked attribute, to check the bake. Not saved |

An impostor can also be baked by hand: right-click a prefab or model in the content browser and choose `Bake Impostor`. Baked impostors are stored under `/assets/.impostor/` and published with the project.

**Collision** — `CollisionShape` makes the copies static obstacles for physics. Sizes left out are fitted to the asset's bounds, which for a tree is its canopy, so set `CollisionRadius` to the trunk.

**System** — on the foliage node itself, `ChunkSize` is the size of the squares instances are drawn and culled in, and `MaskCellSize` the resolution of the painted density.

---

## Roads and foliage

A road fitted to the terrain clears foliage along it (see [Road Tools](en/editor/road-tools.md)).

## AI and scripting

The desktop editor's MCP server exposes `foliage_get_info`, `foliage_set_layers`, `foliage_paint`, `foliage_erase`, `foliage_regenerate` and `foliage_scatter`, so an agent or external tool can lay out a forest. See [Desktop Editor](en/editor/desktop.md).

> Tip: dense forests are expensive. Cover large areas with impostors and a moderate `CullDistance`, and paint in batches, saving between them.
