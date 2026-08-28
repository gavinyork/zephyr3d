# Eye Material

Eyes matter far out of proportion to their screen area — they are the first thing a viewer looks at, and
their characteristic features (the iris displaced by corneal refraction, the sense of pupil depth, the
dark ring at the edge) are exactly the things a general PBR material cannot express.

`EyeMaterial` shades the whole eyeball — sclera, limbus and iris — from **one mesh and one material**.

## Why there is no separate cornea layer

The common approach is a transparent cornea shell over the eyeball, but that brings in transparency
sorting, OIT and depth conflicts.

Instead the view ray is **refracted**: the corneal bulge is not expressed as geometry, but by refracting
the view ray before looking up the iris texture, producing the parallax of an iris sitting below the
surface. So there is no second transparent surface, no OIT, and no depth sorting.

Refraction works in **tangent space** (per-fragment TBN) rather than object space, because after
skinning the shader cannot reconstruct a fixed object-space gaze axis. The residual error from the
sphere's curvature is small at the depths an iris actually sits.

## Asset requirements

This approach needs no mask texture: the regions are derived **analytically from the UV distance to the
iris centre**. The cost is that the asset must follow a convention:

- **A single eyeball mesh** (sphere or front dome), carrying both **normals and tangents**.
  **Without tangents there is no TBN and refraction degrades to a flat iris** — the most common problem.
- **UVs must place the pupil centre at `irisCenter`** (default `(0.5, 0.5)`), with the iris occupying a
  disc of radius `irisRadius` (default 0.22) around it.
- **The iris texture must have the pupil at its centre.** A sclera texture is optional; without one the
  sclera is shaded from `scleraColor`.

If the iris is in the wrong place or the wrong size, check the UV layout and these two parameters before
touching refraction.

## Iris and cornea

| Property | Default | Purpose |
| --- | --- | --- |
| `irisCenter` | (0.5, 0.5) | Pupil centre in UV space |
| `irisRadius` | 0.22 | Iris disc radius (UV units) |
| `irisDepth` | 0.06 | Iris depth below the corneal surface, driving parallax strength |
| `ior` | 1.376 | Corneal index of refraction; 1.376 is the measured human value |
| `pupilRadius` | 0.35 | Pupil radius, relative to the iris |
| `pupilDilation` | 0 | Pupil scaling, for lighting changes or emotion |
| `irisColor` | — | Iris tint |
| `irisBrightness` | — | Iris brightness |
| `corneaSpecularStrength` | — | Corneal highlight strength |
| `corneaRoughness` | 0.05 | Corneal roughness — very low, the cornea is nearly a mirror |

`irisDepth` and `ior` together set how strong the parallax is. Increase `irisDepth` for a deeper look,
but too much gives the illusion away at grazing angles.

## Limbus and sclera

| Property | Default | Purpose |
| --- | --- | --- |
| `limbalRingWidth` | 0.15 | Width of the dark ring at the corneal edge |
| `limbalRingStrength` | — | Ring strength |
| `scleraColor` | — | Sclera colour, used when there is no texture |
| `scleraWrap` | 0.35 | Wrap diffuse on the sclera, softening the terminator |
| `scleraEdgeTint` | — | Sclera edge tint, approximating vessels and shadowing |

**The limbal ring is one of the details that sells an eye as real.** Real irises have a band of pigment
at their outer edge, and without it eyes look flat and textured-on.

## Socket occlusion (optional)

A bare eyeball lights up uniformly under ambient light, because it does not know it sits inside a socket.
The engine offers two complementary occlusion layers, **both off by default**.

### Analytic socket occlusion

```javascript
material.socketOcclusion = true;
material.upperLidAngle = 50;   // degrees
material.lowerLidAngle = 65;
```

This models the lids as an **asymmetric aperture**: around an axis fixed in the eyeball's object space
(rotatable via `socketRotation`), with separate upper and lower opening angles. Directions outside the
aperture darken ambient diffuse, ambient specular and direct lights. No mask texture, extra pass or
per-frame scripting is involved.

Using object space means the occlusion frame **follows skinning and node motion automatically**, and
vertical gaze drags the occlusion along with the eye — approximating how real upper lids follow it.
Horizontal gaze rotating about the up axis leaves the occlusion unchanged, which also matches reality.

`socketOcclusionSoftness` and `socketOcclusionStrength` tune the transition and the amount.

::: warning If nothing changes, check vertexNormal first
Socket occlusion is gated on `vertexNormal`. If you set `socketOcclusion = true` and see no difference,
make sure `vertexNormal` is enabled.
:::

### Screen-space contact occlusion

```javascript
material.contactAO = true;
```

The analytic aperture is a **model** of the lids; this layer reads the depth prepass and therefore
follows the **real lid mesh** — blinks, asymmetry, lashes and all.

It dims the ambient terms and the diffuse response of direct lights (whose shadow maps cannot resolve
the millimetre lid gap), but **leaves direct specular untouched** so the corneal highlight survives.

Related parameters: `contactAORadius` (default 0.006), `contactAOMinDistance`, `contactAOMaxDistance`,
`contactAOStrength` and `contactAOTemporalJitter`.

::: tip Requires a depth prepass
This layer depends on a depth prepass. The Forward+ pipeline always runs one, so it is normally
available; where none is bound the term **silently resolves to no occlusion** rather than erroring.
:::

Both layers can be enabled together: the analytic one provides stable base occlusion, and contact
occlusion adds the dynamic detail of the real lids.

<div class="showcase" case="tut-72"></div>

## See also

- [Skin and Subsurface Scattering](en/material-skin.md) — the skin half of character rendering
- [Hair Rendering](en/material-hair.md) — the hair half of character rendering
- [Custom Materials](en/user-material.md) — the general material system
