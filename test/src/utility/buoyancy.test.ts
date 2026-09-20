/**
 * Checks for the buoyancy volume and the floating body it drives.
 *
 * Pure CPU: the point is the force model, which has to balance a hull at its
 * configured waterline and right it when it rolls, regardless of what
 * integrates it.
 */

import { Quaternion, Vector3 } from '@zephyr3d/base';
import { BuoyancyVolume, FloatingBody, STANDARD_GRAVITY } from '../../../libs/scene/src/utility/buoyancy';

const flat = () => 0;

describe('BuoyancyVolume', () => {
  test('the rest height puts the configured share of the hull under', () => {
    const volume = new BuoyancyVolume({ size: new Vector3(2, 1, 4), submergedFraction: 0.25 });
    expect(volume.draft).toBeCloseTo(0.25);
    expect(volume.restHeight).toBeCloseTo(0.25);
    expect(volume.restY(3)).toBeCloseTo(3.25);
  });

  test('at rest, level, buoyancy balances weight with no torque', () => {
    const volume = new BuoyancyVolume({
      size: new Vector3(2, 1, 4),
      mass: 500,
      submergedFraction: 0.5,
      probeLayers: 4
    });
    const force = new Vector3();
    const torque = new Vector3();
    const submerged = volume.computeForces(
      new Vector3(0, volume.restY(0), 0),
      new Quaternion(),
      flat,
      0,
      force,
      torque
    );
    expect(submerged).toBeCloseTo(0.5);
    expect(force.y).toBeCloseTo(500 * STANDARD_GRAVITY, 3);
    expect(force.x).toBe(0);
    expect(force.z).toBe(0);
    // Zero up to the float32 rounding of forces in the tens of kilonewtons.
    expect(torque.magnitude).toBeLessThan(1e-3);
  });

  test('pushed deeper the lift grows, lifted clear it vanishes', () => {
    const volume = new BuoyancyVolume({ size: new Vector3(2, 1, 4), mass: 500, probeLayers: 4 });
    const force = new Vector3();
    const torque = new Vector3();
    const rest = volume.restY(0);
    volume.computeForces(new Vector3(0, rest - 0.25, 0), new Quaternion(), flat, 0, force, torque);
    expect(force.y).toBeGreaterThan(500 * STANDARD_GRAVITY);
    volume.computeForces(new Vector3(0, rest - 5, 0), new Quaternion(), flat, 0, force, torque);
    // Fully under: the whole lift, and no more however deep.
    expect(force.y).toBeCloseTo(volume.maxBuoyancy, 3);
    volume.computeForces(new Vector3(0, rest + 5, 0), new Quaternion(), flat, 0, force, torque);
    expect(force.y).toBe(0);
  });

  test('a rolled hull is pushed back upright', () => {
    const volume = new BuoyancyVolume({ size: new Vector3(2, 1, 4), mass: 500 });
    const force = new Vector3();
    const torque = new Vector3();
    // Rolled 20 degrees about Z: the +X side goes down, and the lift there has
    // to produce a torque about Z that rolls it back the other way.
    const roll = Quaternion.fromEulerAngle(0, 0, (20 * Math.PI) / 180, 'ZYX');
    volume.computeForces(new Vector3(0, volume.restY(0), 0), roll, flat, 0, force, torque);
    expect(torque.z).toBeLessThan(0);
    expect(Math.abs(torque.x)).toBeLessThan(Math.abs(torque.z) * 0.01);
  });

  test('a wave under one end lifts that end', () => {
    const volume = new BuoyancyVolume({ size: new Vector3(2, 1, 4), mass: 500 });
    const force = new Vector3();
    const torque = new Vector3();
    // Water higher towards +Z: the +Z probes are deeper and push harder, which
    // is a torque about -X.
    volume.computeForces(
      new Vector3(0, volume.restY(0), 0),
      new Quaternion(),
      (_x, z) => z * 0.1,
      0,
      force,
      torque
    );
    expect(torque.x).toBeLessThan(0);
  });
});

describe('FloatingBody', () => {
  test('settles at the waterline on still water', () => {
    const body = new FloatingBody({ size: new Vector3(2, 1, 4), mass: 500, submergedFraction: 0.5 });
    // Dropped from a metre up, lying level.
    body.position.setXYZ(0, 1, 0);
    for (let i = 0; i < 600; i++) {
      body.update(1 / 60, flat, 0);
    }
    expect(body.position.y).toBeCloseTo(body.volume.restY(0), 2);
    expect(body.velocity.magnitude).toBeLessThan(0.01);
    expect(Math.abs(body.rotation.w)).toBeCloseTo(1, 4);
  });

  test('rights itself from a roll', () => {
    const body = new FloatingBody({ size: new Vector3(2, 1, 4), mass: 500 });
    body.reset(0, 0, 0, 0);
    Quaternion.fromEulerAngle(0, 0, (30 * Math.PI) / 180, 'ZYX', body.rotation);
    for (let i = 0; i < 900; i++) {
      body.update(1 / 60, flat, 0);
    }
    // Back to (near) identity: the Z component of the quaternion carries the roll.
    expect(Math.abs(body.rotation.z)).toBeLessThan(0.02);
  });

  test('the fixed step does not depend on the frame size', () => {
    const a = new FloatingBody({ size: new Vector3(2, 1, 4), mass: 500 });
    const b = new FloatingBody({ size: new Vector3(2, 1, 4), mass: 500 });
    a.position.setXYZ(0, 0.8, 0);
    b.position.setXYZ(0, 0.8, 0);
    for (let i = 0; i < 120; i++) {
      a.update(1 / 60, flat, 0);
    }
    for (let i = 0; i < 60; i++) {
      b.update(1 / 30, flat, 0);
    }
    expect(a.position.y).toBeCloseTo(b.position.y, 6);
  });

  test('an external force is applied once and cleared', () => {
    const body = new FloatingBody({
      size: new Vector3(2, 1, 4),
      mass: 500,
      linearDamping: 0,
      airLinearDamping: 0
    });
    body.reset(0, 0, 0, 0);
    body.externalForce.setXYZ(1000, 0, 0);
    body.update(1 / 60, flat, 0);
    expect(body.velocity.x).toBeGreaterThan(0);
    expect(body.externalForce.x).toBe(0);
    const vx = body.velocity.x;
    body.update(1 / 60, flat, 0);
    // No more push, and air/water damping is off: the speed holds.
    expect(body.velocity.x).toBeCloseTo(vx, 6);
  });
});
