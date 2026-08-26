/**
 * Behaviour of the strand solver, on a CPU model of the same recurrence.
 *
 * The solver is a compute pass, so the shader itself cannot run here. What can
 * run is the arithmetic it performs, transcribed stage for stage from
 * `createHairSimulationProgram`, which is where the properties under test live:
 * whether a moving root pumps energy into a strand, and whether a disturbance
 * dies out or rings.
 *
 * Node motion reaches the solver the way it does in the real thing: the roots
 * are pinned in local space and the frame-to-frame transform carries the rest of
 * the strand, so a node translating by `d` shows up as `relativeTransform`
 * moving every stored position by `-d`.
 */

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

type SolverOptions = {
  /** How strongly a strand keeps the shape it was authored with. */
  localStiffness: number;
  /** Local shape constraint passes per substep. */
  localIterations: number;
  /** Share of a point's length correction fed back into its parent. */
  ftlDamping: number;
  /** How much of the node's motion a strand is carried along by. */
  vspCoeff: number;
  /** Pull back to the authored pose, and the fraction of the strand it acts on. */
  globalStiffness: number;
  globalRange: number;
  /** Per-substep ceiling on point travel, in segment lengths. */
  maxSpeedFactor: number;
};

const POINT_COUNT = 24;
const SEGMENT = 0.05;
/** 1.15 m: how far the tip can possibly get from the root. */
const STRAND_LENGTH = (POINT_COUNT - 1) * SEGMENT;
const SUBSTEP = 1 / 60;
const GRAVITY: Vec3 = [0, -9.8, 0];
const DAMPING = 0.08;
const MIN_DISTANCE = 1e-7;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function norm(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}
function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n > MIN_DISTANCE ? scale(a, 1 / n) : [0, 0, 0];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The shortest-arc rotation taking unit u onto unit v. */
function quatFromUnitVectors(u: Vec3, v: Vec3): Vec4 {
  let r = 1 + dot(u, v);
  let axis = cross(u, v);
  if (r < 1e-7) {
    r = 0;
    axis = Math.abs(u[0]) > Math.abs(u[2]) ? [-u[1], u[0], 0] : [0, -u[2], u[1]];
  }
  const lengthSq = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2] + r * r;
  if (lengthSq <= 1e-10) {
    return [0, 0, 0, 1];
  }
  const s = 1 / Math.sqrt(lengthSq);
  return [axis[0] * s, axis[1] * s, axis[2] * s, r * s];
}

function quatRotate(q: Vec4, v: Vec3): Vec3 {
  const qv: Vec3 = [q[0], q[1], q[2]];
  const uv = cross(qv, v);
  const uuv = cross(qv, uv);
  return add(v, add(scale(uv, 2 * q[3]), scale(uuv, 2)));
}

/**
 * Runs the solver over a strand hanging from a node driven sideways, and
 * reports how far the tip stood from the root at each step.
 */
function run(options: SolverOptions, steps: number, drive: (t: number) => number) {
  const rest: Vec3[] = [];
  for (let i = 0; i < POINT_COUNT; i++) {
    rest.push([0, -i * SEGMENT, 0]);
  }
  const points = rest.map((p) => [...p] as Vec3);
  const prevPoints = rest.map((p) => [...p] as Vec3);
  const dampingDecay = Math.exp(-DAMPING * SUBSTEP * 60);
  const dt2 = SUBSTEP * SUBSTEP;
  const localStrength = Math.min(options.localStiffness, 0.95) * 0.5;
  const rangeLimit = options.globalRange * POINT_COUNT;
  const swings: number[] = [];
  const stretches: number[] = [];
  let nodeX = drive(0);

  for (let step = 1; step <= steps; step++) {
    // The node's motion for this step, as the solver sees it: a point that
    // stood still in the world has moved by -delta in local space.
    const nextX = drive(step * SUBSTEP);
    const delta = nextX - nodeX;
    nodeX = nextX;

    // The first two points are pinned, which in local space means unchanged.
    points[0] = [...rest[0]];
    prevPoints[0] = [...rest[0]];
    points[1] = [...rest[1]];
    prevPoints[1] = [...rest[1]];

    // Stage 1 - integrate, propagate the shock, pull toward the pose.
    for (let i = 2; i < POINT_COUNT; i++) {
      const lag = delta * (1 - options.vspCoeff);
      const current: Vec3 = [points[i][0] - lag, points[i][1], points[i][2]];
      const previous: Vec3 = [prevPoints[i][0] - lag, prevPoints[i][1], prevPoints[i][2]];
      const velocity = scale(sub(current, previous), dampingDecay);
      let next = add(add(current, velocity), scale(GRAVITY, dt2));
      if (options.globalStiffness > 0 && i < rangeLimit) {
        next = add(next, scale(sub(rest[i], next), options.globalStiffness));
      }
      prevPoints[i] = current;
      points[i] = next;
    }

    // Stage 2 - local shape constraint.
    for (let iter = 0; iter < options.localIterations; iter++) {
      for (let i = 1; i < POINT_COUNT - 1; i++) {
        const pos = points[i];
        const posPlus = points[i + 1];
        const posMinus = points[i - 1];
        const lastVec = sub(pos, posMinus);
        const bindVec = sub(rest[i + 1], rest[i]);
        const lastBindVec = sub(rest[i], rest[i - 1]);
        const rotation = quatFromUnitVectors(unit(lastBindVec), unit(lastVec));
        const target = add(quatRotate(rotation, bindVec), pos);
        const del = scale(sub(target, posPlus), localStrength);
        if (i > 1) {
          points[i] = sub(pos, del);
        }
        points[i + 1] = add(posPlus, del);
      }
    }

    // Stage 3 - length constraints, root to tip, with the correction handed
    // back to the parent as reverse momentum.
    for (let j = 1; j < POINT_COUNT - 1; j++) {
      const parent = points[j];
      const predicted = points[j + 1];
      const offset = sub(predicted, parent);
      const dist = norm(offset);
      const projected =
        dist > MIN_DISTANCE
          ? add(parent, scale(offset, SEGMENT / dist))
          : add(parent, [0, SEGMENT, 0] as Vec3);
      points[j + 1] = projected;
      if (j > 1) {
        prevPoints[j] = add(prevPoints[j], scale(sub(projected, predicted), options.ftlDamping));
      }
    }

    // Stage 4 - no colliders here, so only the speed ceiling.
    for (let i = 2; i < POINT_COUNT; i++) {
      const travel = sub(points[i], prevPoints[i]);
      const speed = norm(travel);
      const limit = SEGMENT * options.maxSpeedFactor;
      if (speed > limit) {
        prevPoints[i] = sub(points[i], scale(travel, limit / speed));
      }
    }

    // How far the tip has swung out of the plane the strand hangs in. Measured
    // against the root rather than the world, so the node's own travel does not
    // count as swing.
    swings.push(Math.abs(points[POINT_COUNT - 1][0] - points[0][0]));
    let total = 0;
    for (let i = 1; i < POINT_COUNT; i++) {
      total += norm(sub(points[i], points[i - 1]));
    }
    stretches.push(total / STRAND_LENGTH);
  }

  const half = Math.floor(swings.length / 2);
  return {
    swings,
    /** Peak swing over a window given in seconds. */
    peak(fromSeconds: number, toSeconds: number) {
      const from = Math.floor(fromSeconds * 60);
      const to = Math.min(swings.length, Math.floor(toSeconds * 60));
      return Math.max(...swings.slice(from, to));
    },
    early: Math.max(...swings.slice(0, half)),
    late: Math.max(...swings.slice(half)),
    final: swings[swings.length - 1],
    maxStretch: Math.max(...stretches)
  };
}

/** A hand-tremor drive: small, and reversing faster than the strand settles. */
function tremor(t: number) {
  return 0.02 * Math.sin(t * 22) + 0.01 * Math.sin(t * 53);
}

/** Held out to one side over a third of a second, then let go. */
function pluck(t: number) {
  return t < 0.3 ? 0.4 * (t / 0.3) : 0.4;
}

const TRESSFX: SolverOptions = {
  localStiffness: 0.9,
  localIterations: 2,
  ftlDamping: 0.7,
  vspCoeff: 0.8,
  globalStiffness: 0,
  globalRange: 0,
  maxSpeedFactor: 4
};

describe('GPU hair solver', () => {
  // 20 s of driving, which is far longer than any settling time in play.
  const STEPS = 60 * 20;

  test('a small sustained drive does not wind the strand up', () => {
    const { early, late } = run(TRESSFX, STEPS, tremor);
    // A bounded response stays the same size over the run. A chain that gains
    // energy per segment does not, and because the segments are coupled in
    // series the gain collects at the free end, so the failure shows up here
    // first and reads as a whip.
    expect(late).toBeLessThan(early * 1.2);
    expect(late).toBeLessThan(STRAND_LENGTH * 0.1);
  });

  test('a plucked strand settles instead of ringing', () => {
    // Held out and released. Hair is not a spring: the swing should die within
    // about a second, not pass back and forth through the hanging line for
    // several more.
    const { peak } = run(TRESSFX, 60 * 8, pluck);
    const released = peak(0.3, 1.3);
    expect(peak(2, 3)).toBeLessThan(released * 0.2);
    expect(peak(5, 8)).toBeLessThan(released * 0.05);
  });

  test('bending resistance is what damps the swing', () => {
    // The same pluck with the local shape constraint switched off. A strand
    // with no bending resistance is a chain of free joints, and a chain rings:
    // this pins that the settling above comes from the constraint rather than
    // from velocity damping, which is identical in both runs.
    const limp = run({ ...TRESSFX, localStiffness: 0 }, 60 * 8, pluck);
    const stiff = run(TRESSFX, 60 * 8, pluck);
    expect(limp.peak(2, 3)).toBeGreaterThan(stiff.peak(2, 3) * 2);
  });

  test('a smooth sweep produces a steady trail', () => {
    // Driven at 1.8 m/s, a groom should track the drive with a settled amount
    // of lag rather than creep toward an answer over half a minute.
    const sweep = (t: number) => 0.25 * Math.sin(t * 7.2);
    const { peak } = run(TRESSFX, 60 * 30, sweep);
    expect(peak(25, 30)).toBeCloseTo(peak(5, 10), 3);
    expect(peak(25, 30)).toBeLessThan(STRAND_LENGTH);
  });

  test('strands do not stretch', () => {
    // The root-to-tip pass places every point at exactly its authored distance
    // from the one before it, so this is exact rather than approached. It is
    // the one deviation from TressFX, whose Jacobi sweeps leave a hanging
    // strand 22% long here at its own iteration count.
    for (const drive of [tremor, pluck, () => 0]) {
      expect(run(TRESSFX, STEPS, drive).maxStretch).toBeLessThan(1.0001);
    }
  });

  test('the speed ceiling is not what is holding it together', () => {
    // With the ceiling lifted the solver must still stay bounded - otherwise
    // the clamp would be masking a solver that gains energy.
    const { early, late } = run({ ...TRESSFX, maxSpeedFactor: 1e6 }, STEPS, tremor);
    expect(late).toBeLessThan(early * 1.2);
  });
});
