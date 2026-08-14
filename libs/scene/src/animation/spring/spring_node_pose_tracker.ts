import type { Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

type SpringNodePoseState = {
  inputRotation: Quaternion;
  appliedRotation: Quaternion;
};

const ROTATION_MATCH_EPSILON_SQ = 1e-10;

function rotationsMatch(a: Quaternion, b: Quaternion): boolean {
  const direct =
    (a.x - b.x) * (a.x - b.x) +
    (a.y - b.y) * (a.y - b.y) +
    (a.z - b.z) * (a.z - b.z) +
    (a.w - b.w) * (a.w - b.w);
  const negated =
    (a.x + b.x) * (a.x + b.x) +
    (a.y + b.y) * (a.y + b.y) +
    (a.z + b.z) * (a.z + b.z) +
    (a.w + b.w) * (a.w + b.w);
  return Math.min(direct, negated) <= ROTATION_MATCH_EPSILON_SQ;
}

/** Keeps spring output from becoming the next frame's unanimated input pose. */
export class SpringNodePoseTracker {
  private _states = new Map<SceneNode, SpringNodePoseState>();

  restoreInputPose(): void {
    for (const [node, state] of this._states) {
      if (rotationsMatch(node.rotation, state.appliedRotation)) {
        node.rotation.set(state.inputRotation);
      } else {
        // Animation, mocap, IK or another upstream system supplied a new pose.
        state.inputRotation.set(node.rotation);
      }
    }
  }

  recordAppliedRotation(node: SceneNode, inputRotation: Quaternion, appliedRotation: Quaternion): void {
    const state = this._states.get(node);
    if (state) {
      state.inputRotation.set(inputRotation);
      state.appliedRotation.set(appliedRotation);
    } else {
      this._states.set(node, {
        inputRotation: inputRotation.clone(),
        appliedRotation: appliedRotation.clone()
      });
    }
  }

  clear(restoreInputPose: boolean): void {
    if (restoreInputPose) {
      this.restoreInputPose();
    }
    this._states.clear();
  }
}
