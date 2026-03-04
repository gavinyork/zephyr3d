import { Quaternion } from '@zephyr3d/base';
import { AnimationTrack } from '../animationtrack';
import type { FABRIKSolver } from './fabrik_solver';

/**
 * IK animation track state.
 *
 * Represents the rotations of all joints in an IK chain at a specific time.
 */
interface IKState {
  /** Array of joint rotations (one per joint, excluding end effector) */
  rotations: Quaternion[];
}

/**
 * Animation track that applies IK solving.
 *
 * @remarks
 * This track integrates IK solving into the animation system, allowing
 * IK to be blended with other animations. The track solves the IK chain
 * each frame and produces joint rotations that can be mixed with other
 * animation tracks.
 *
 * @public
 */
export class IKTrack extends AnimationTrack<IKState> {
  /** The IK solver */
  private _solver: FABRIKSolver;
  /** Cached state for reuse */
  private _state: IKState;
  /** Duration of the track (can be infinite for procedural IK) */
  private _duration: number;

  /**
   * Create an IK animation track.
   *
   * @param solver - The FABRIK solver to use
   * @param duration - Duration of the track in seconds (default: Infinity for procedural)
   */
  constructor(solver: FABRIKSolver, duration = Infinity) {
    super(false);
    this._solver = solver;
    this._duration = duration;

    // Initialize state with identity rotations
    const numJoints = solver.chain.joints.length - 1; // Exclude end effector
    this._state = {
      rotations: Array.from({ length: numJoints }, () => new Quaternion())
    };
  }

  /**
   * Get the IK solver.
   */
  get solver(): FABRIKSolver {
    return this._solver;
  }

  /**
   * Set the duration of the track.
   */
  setDuration(duration: number): void {
    this._duration = Math.max(0, duration);
  }

  /**
   * Calculate IK state at the given time.
   *
   * @remarks
   * For procedural IK, the time parameter is typically ignored.
   * The solver uses the current target position set externally.
   */
  calculateState(_target: object, _currentTime: number): IKState {
    const joints = this._solver.chain.joints;

    // Store current rotations as the calculated state
    for (let i = 0; i < joints.length - 1; i++) {
      this._state.rotations[i].set(joints[i].rotation);
    }

    return this._state;
  }

  /**
   * Apply IK state to the target scene nodes.
   */
  applyState(_target: object, state: IKState): void {
    const joints = this._solver.chain.joints;

    // Apply rotations to scene nodes
    for (let i = 0; i < state.rotations.length && i < joints.length - 1; i++) {
      joints[i].node.rotation = state.rotations[i];
    }
  }

  /**
   * Mix two IK states using spherical interpolation.
   */
  mixState(a: IKState, b: IKState, t: number): IKState {
    const result: IKState = {
      rotations: []
    };

    const count = Math.min(a.rotations.length, b.rotations.length);
    for (let i = 0; i < count; i++) {
      result.rotations.push(Quaternion.slerp(a.rotations[i], b.rotations[i], t));
    }

    return result;
  }

  /**
   * Get the blend identifier for this track.
   *
   * IK tracks with the same root joint can be blended together.
   */
  getBlendId(): string {
    const rootNode = this._solver.chain.root.node;
    return `ik-chain-${rootNode.runtimeId}`;
  }

  /**
   * Get the duration of this track.
   */
  getDuration(): number {
    return this._duration;
  }
}
