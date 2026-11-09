# Road Tools

A road node (RoadSpline) builds a road surface along a smooth curve through its control points. It can cut and fill the terrain to fit the road and clear grass and foliage along it, which makes it suited to off-road and rally tracks.

---

## Creating a Road

- Select `Add → Road` from the main menu and click on a terrain to place it. A road placed on a terrain becomes a child of that terrain. Roads need to be under a terrain: the shoulders lie on it and terrain fitting shapes it.
- A new road has no control points yet. Select it and click the edit button in the toolbar to open the road edit tool, then place points.

The road follows the heights of its control points, not the ground: lay out its course first, then use Fit profile and Fit terrain (see below) to make road and ground agree.

---

## Road Edit Tool

Select the road and click the edit button in the toolbar. The scene view draws the center line, both road edges and the control points, and the `Road` panel opens.

**Editing control points**

| Action | Effect |
|---|---|
| Drag a control point | Moves it over the ground, keeping its height above the ground |
| Alt + drag a control point | Moves it up and down |
| Click the ground with `Add points` checked | Adds a point at the end of the road |
| Ctrl + click the ground | Inserts a point where the road passes nearest, at the height of the road there |
| Delete | Removes the selected point |
| Esc | Clears the selection and leaves the add mode |

With fewer than two points the tool starts in the add mode. Every change can be undone.

**Properties of the selected point**

- `Above ground`: height of the point above the ground.
- `Width`: road width at the point, 0 for the road's `Width`; it changes smoothly between points.
- `Bank`: roll of the road at the point; positive raises the right edge, for banked bends.

**Warnings**

The panel shows the road length, the tightest bend radius and the steepest grade. In the scene view:

- A red center line marks grades above 12%.
- Red road edges mark bends too tight for the road width, where the inner side has been narrowed so the surface does not fold over.

---

## Fit Profile

`Fit profile` samples the ground under the center line every meter, smooths it over about 30 meters, limits the grade to 12%, and sets the heights of the control points from it. Only the heights change, not the course.

Fit the profile before fitting the terrain, so the cuts and fills stay small.

---

## Fit Terrain

`Fit terrain` shapes the terrain to the road the way a real road is built:

- **Bench**: under the road and 1 meter beyond each edge, the ground is leveled about 10 centimeters below the road surface.
- **Slopes**: beyond the bench, the ground is kept between a cut slope (1:1 by default, about 45°) and a fill slope (1:1.5 by default, about 34°); only ground steeper than these changes.
- **Rounding**: a slope eases in from the bench over 3 meters at its toe and into the natural ground over about 2 meters at its top, so a vehicle running off the road meets no hard crease.
- **Grass and foliage**: grass is cleared over the road, the shoulders and 0.5 meters beyond, growing back over the next 1.5 meters, and thinned on the slopes by how much they were cut or filled; foliage instances along the road are removed.

**Fitting again**

The first fit records the terrain as it was over the area it changed (heights, texture weights and grass density) and saves it with the scene. Fitting again after the road moved first puts that ground back, then cuts and fills anew, so the old course leaves no trace.

- `Restore terrain`: puts the original ground back and forgets it.
- `Commit terrain`: forgets the original ground; the terrain as it is becomes the ground the next fit starts from.

> Note: terrain brush edits made along the road after fitting are overwritten by the original ground on the next fit. Commit first to keep them. Removed foliage does not come back with a restore; use undo or scatter it again.

---

## Shoulders and Terrain Blending

Each side of the road has a shoulder (`ShoulderWidth`, 1 meter by default) running from the road surface into the ground:

- **On WebGPU, with the terrain's runtime virtual texture (RVT) on**: the shoulders read the ground color, normal and roughness from the terrain's RVT and blend from the road material into the ground, so the edges merge into the terrain. Recommended.
- **Otherwise**: the shoulders fade out with dithered transparency, which needs TAA to look smooth.

Turn on `RuntimeVirtualTexture` in the terrain properties. With `ShoulderMaterial` left empty, the engine picks between the two as above; a material set there is used as it is.

---

## Road Properties

| Property | Description |
|---|---|
| `Points` | The control points, also editable in the property panel |
| `Closed` | Connects the last point back to the first for a loop (at least 3 points) |
| `Width` | Default road width (meters) |
| `ShoulderWidth` | Width of each shoulder (meters), 0 for none |
| `Material` | Road surface material; a plain gray one when empty |
| `ShoulderMaterial` | Shoulder material, usually left empty |
| `UVTileLength` / `UVTileWidth` | Meters along and across the road per texture repeat, usually the real size of the texture |
| `SampleSpacing` | Distance between mesh cross sections (meters) |
| `ChunkLength` | Length of the stretches the road is drawn and culled in (meters) |
| `SurfaceTag` | Name of the kind of surface, for game scripts telling roads apart (e.g. gravel, asphalt) |
| `Collision` / `Friction` | Whether the road has static colliders, and their friction |
| `CastShadow` | Whether the road casts shadows |

The surface texture runs along the road; set the texture address mode of its material to `repeat`.

---

## Using Roads in Scripts

`RoadSpline` answers queries at runtime, for timing, checkpoints and respawning:

- `length`: length of the road.
- `sampleAt(s, frame)`: position, directions, width and bank `s` meters from the start, in world space.
- `project(position, out)`: the closest center line point to a world position, with its distance `s` along the road and the sideways offset.
- `ownsNode(node)`: whether a node belongs to the road.

Wheels use their own grip (`Wheel.frictionSlip`), not the friction of colliders. To give the road and the off-road ground different grip, test in a script whether a wheel is on the road from `wheel.groundNode` (`road.ownsNode(wheel.groundNode)`), and set the wheel's `frictionSlip` by `surfaceTag`.
