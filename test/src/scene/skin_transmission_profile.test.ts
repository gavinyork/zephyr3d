import { SkinProfile } from '@zephyr3d/scene';
import {
  SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH,
  SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT
} from '../../../libs/scene/src/material/skinprofile';
import { Vector3 } from '@zephyr3d/base';

/**
 * Behavioural checks on the baked transmission profile.
 *
 * These assert the *shape* of the curve rather than the presence of the formula:
 * the whole point of the table is that transmission falls off with thickness and
 * does so per channel, and a rewrite that keeps every constant while cancelling
 * the falloff downstream would still be wrong. Earlier rounds of this work had
 * exactly that failure mode.
 */
function bake(p: SkinProfile): Float32Array {
  const out = new Float32Array(SkinProfile.transmissionLutSize * 4);
  p.writeTransmissionProfile(out);
  return out;
}

const red = (lut: Float32Array, i: number) => lut[i * 4];
const green = (lut: Float32Array, i: number) => lut[i * 4 + 1];
const blue = (lut: Float32Array, i: number) => lut[i * 4 + 2];
const alpha = (lut: Float32Array, i: number) => lut[i * 4 + 3];

describe('Skin transmission profile', () => {
  test('falls off monotonically with thickness', () => {
    const p = new SkinProfile('skin');
    const lut = bake(p);
    for (let i = 1; i < SkinProfile.transmissionLutSize; i++) {
      expect(red(lut, i)).toBeLessThan(red(lut, i - 1));
    }
    p.dispose();
  });

  test('the last entry is forced black', () => {
    // UE5's bMakeLastPixelBlack. Without it the red tail is still visible after
    // tone mapping, and anything thicker than the table would keep transmitting.
    const p = new SkinProfile('skin');
    const lut = bake(p);
    const last = SkinProfile.transmissionLutSize - 1;
    expect(red(lut, last)).toBe(0);
    expect(green(lut, last)).toBe(0);
    expect(blue(lut, last)).toBe(0);
    expect(alpha(lut, last)).toBe(0);
    p.dispose();
  });

  test('red survives thickness that green and blue do not', () => {
    // This is the whole reason a backlit ear reads red rather than grey: skin's
    // red mean free path is an order of magnitude longer than blue's, so the
    // three channels have to decay at visibly different rates.
    const p = new SkinProfile('skin');
    const lut = bake(p);
    expect(red(lut, 0)).toBeGreaterThan(green(lut, 0));
    expect(green(lut, 0)).toBeGreaterThan(blue(lut, 0));
    // The claim is about the *rates*, not one sample of them, so assert the one
    // thing that distinguishes differing rates from a constant tint: the ratio
    // has to keep opening up as the table goes deeper. A neutral falloff with a
    // red tint bolted on would pass the two checks above and fail this.
    const live = SkinProfile.transmissionLutSize - 1;
    for (let i = 1; i < live; i++) {
      expect(red(lut, i) / green(lut, i)).toBeGreaterThan(red(lut, i - 1) / green(lut, i - 1));
    }
    // And the spread has to be substantial by the middle of the table, not a
    // rounding difference.
    expect(red(lut, live >> 1) / green(lut, live >> 1)).toBeGreaterThan(100);
    p.dispose();
  });

  test('a longer mean free path stretches the curve rather than scaling it', () => {
    // Regression guard of the same family as the diffusion kernel's: the
    // distance axis is fixed and the mean free path has to move where the curve
    // lands on it. Normalising the two against each other would leave the shape
    // identical and make the control inert.
    const near = new SkinProfile('skin');
    const far = new SkinProfile('skin');
    far.meanFreePathDistance = near.meanFreePathDistance * 4;
    const lutNear = bake(near);
    const lutFar = bake(far);
    // Same start (both are dominated by the radius offset there), but the long
    // profile is still transmitting well past where the short one has died.
    const mid = 8;
    expect(red(lutFar, mid)).toBeGreaterThan(red(lutNear, mid) * 4);
    near.dispose();
    far.dispose();
  });

  test('world unit scale moves the distance axis, not the profile', () => {
    // A model authored at four times life size has to reach the same entry at
    // four times the geometric thickness, which is the same relationship the
    // thickness pass encodes. Scaling the profile instead would make the same
    // material look different on a resized asset.
    const unit = new SkinProfile('skin');
    const big = new SkinProfile('skin');
    big.worldUnitScale = 4;
    const lutUnit = bake(unit);
    const lutBig = bake(big);
    // Entry i of the scaled profile stands for a quarter of the profile-space
    // distance, so it must have decayed less.
    for (let i = 1; i < SkinProfile.transmissionLutSize - 1; i++) {
      expect(red(lutBig, i)).toBeGreaterThan(red(lutUnit, i));
    }
    unit.dispose();
    big.dispose();
  });

  test('the tint multiplies the profile and nothing else', () => {
    const plain = new SkinProfile('skin');
    plain.transmissionTint = new Vector3(1, 1, 1);
    const tinted = new SkinProfile('skin');
    tinted.transmissionTint = new Vector3(1, 0.5, 0.25);
    const a = bake(plain);
    const b = bake(tinted);
    for (let i = 0; i < SkinProfile.transmissionLutSize - 1; i++) {
      expect(red(b, i)).toBeCloseTo(red(a, i), 6);
      expect(green(b, i)).toBeCloseTo(green(a, i) * 0.5, 6);
      expect(blue(b, i)).toBeCloseTo(blue(a, i) * 0.25, 6);
      // The alpha is the separate extinction curve and the tint must not reach it.
      expect(alpha(b, i)).toBeCloseTo(alpha(a, i), 6);
    }
    plain.dispose();
    tinted.dispose();
  });

  test('surface albedo shapes the falloff', () => {
    // The scaling factor s = 3.5 + 100 (A - 0.33)^4 is minimised at 0.33, which
    // gives the slowest decay. Dropping albedo out of the bake — it is easy to,
    // since UE5 passes white for the profile's own `A` — would make this inert.
    const wide = new SkinProfile('skin');
    wide.surfaceAlbedo = new Vector3(0.33, 0.33, 0.33);
    const tight = new SkinProfile('skin');
    tight.surfaceAlbedo = new Vector3(0.95, 0.95, 0.95);
    const lutWide = bake(wide);
    const lutTight = bake(tight);
    expect(red(lutWide, 4)).toBeGreaterThan(red(lutTight, 4));
    wide.dispose();
    tight.dispose();
  });

  test('extinction scale drives the alpha curve alone', () => {
    const slow = new SkinProfile('skin');
    slow.extinctionScale = 0.5;
    const fast = new SkinProfile('skin');
    fast.extinctionScale = 2;
    const a = bake(slow);
    const b = bake(fast);
    expect(alpha(b, 4)).toBeLessThan(alpha(a, 4));
    // The rgb falloff is Burley's and must not follow it.
    expect(red(b, 4)).toBeCloseTo(red(a, 4), 6);
    slow.dispose();
    fast.dispose();
  });

  test('optical depth is calibrated against the table it indexes', () => {
    // The invariant that ties the thickness pass to the baked profile, and the
    // one that broke: a light path of `t` world units has to land on the table
    // entry that was baked for that same physical distance. Get it wrong and the
    // feature does not look mis-tuned, it looks absent — a factor of ten put
    // every path over 5 mm onto the blacked-out last entry, so nothing
    // transmitted anywhere while the thickness debug view still looked sane.
    const p = new SkinProfile('skin');
    const size = SkinProfile.transmissionLutSize;
    for (const metres of [0.002, 0.005, 0.01, 0.03]) {
      // What the thickness pass produces, at unit extinction.
      const opticalDepth = metres * SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT;
      // Where the BxDF then reads, and what that entry was baked for. The pass
      // and the bake disagree by 31/32 on the axis, as UE5's do, so allow it.
      const index = (opticalDepth / SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH) * (size - 1);
      const bakedForMm = (index / size) * 50;
      expect(bakedForMm).toBeCloseTo(metres * 1000, 1);
    }
    p.dispose();
  });

  test('a head-sized path saturates but a thin one does not', () => {
    // The practical consequence, stated in the units a scene is authored in.
    // At unit extinction the table has to span roughly a centimetre per unit of
    // optical depth, so skin millimetres land in the live part of the curve and
    // a path through a skull runs off the end.
    const size = SkinProfile.transmissionLutSize;
    const indexFor = (metres: number) =>
      ((metres * SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT) / SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH) * (size - 1);
    // A 5 mm ear has to sit well inside the table, not against either end.
    expect(indexFor(0.005)).toBeGreaterThan(1);
    expect(indexFor(0.005)).toBeLessThan(size / 2);
    // A 20 cm skull has to run past it.
    expect(indexFor(0.2)).toBeGreaterThan(size - 1);
  });

  test('the profile entry a path reaches is invariant to the asset scale', () => {
    // What `worldUnitScale` has to preserve, stated where it can be checked
    // exactly. It is deliberately absent from the optical depth - it divides
    // both the baked table's distance axis and the conversion of a geometric
    // path into profile space, so it cancels out of the lookup, and UE5 keeps it
    // out of `CalculateOpticalDepth` for the same reason.
    //
    // The consequence is easy to misread: the *encoded thickness* of a 4x asset
    // is four times that of the 1x one, which looks like a scale bug and was
    // once "fixed" by dividing it out a second time. What must actually match is
    // the entry the BxDF ends up reading, and that is this.
    const size = SkinProfile.transmissionLutSize;
    const sample = (p: SkinProfile, metres: number) => {
      const lut = new Float32Array(size * 4);
      p.writeTransmissionProfile(lut);
      const index = ((metres * SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT) / SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH) * (size - 1);
      const i0 = Math.min(Math.floor(index), size - 1);
      const i1 = Math.min(i0 + 1, size - 1);
      const f = index - i0;
      return lut[i0 * 4] * (1 - f) + lut[i1 * 4] * f;
    };
    const unit = new SkinProfile('skin');
    const big = new SkinProfile('skin');
    big.worldUnitScale = 4;
    // Only over paths both profiles can represent. The encoding saturates at a
    // fixed 48 mm of *world* path whatever the unit scale is, so the 4x asset
    // runs off the end of the table at a quarter of the geometry the 1x one
    // does. `worldUnitScale` does not widen that window - it changes the shape
    // of the falloff inside it - and `extinctionScale` is the knob that does.
    for (const metres of [0.002, 0.005, 0.01]) {
      const a = sample(unit, metres);
      const b = sample(big, metres * 4);
      // Not exactly equal, and the gap is understood rather than tolerated.
      // UE5 scales its `ProfileRadiusOffset` by the unit scale but not the mean
      // free path the offset is then exponentiated against, so the two curves
      // sit a constant `exp(s dr / 3L)` apart - about 9% at the skin defaults,
      // independent of distance. That is inherited, not introduced. What this
      // guards is the factor of four that appears the moment `worldUnitScale`
      // is put back into the optical depth, or taken out of the table's axis.
      expect(Math.abs(b - a) / Math.max(a, 1e-6)).toBeLessThan(0.12);
    }
    unit.dispose();
    big.dispose();
  });

  test('profile ids index the table rows the shader addresses', () => {
    // The shader recovers a row as `clamp(id, 0, 1) * 255`, so the encoded id
    // has to land back on the integer id the table was packed at.
    const p = new SkinProfile('skin');
    expect(Math.round(p.encodedId * 255)).toBe(p.id);
    // And the LUT has to sit past the scalar parameters, not overlap them.
    expect(SkinProfile.transmissionLutOffset).toBeGreaterThan(SkinProfile.transmissionParamColumn);
    expect(SkinProfile.tableColumns).toBe(
      SkinProfile.transmissionLutOffset + SkinProfile.transmissionLutSize
    );
    p.dispose();
  });
});
