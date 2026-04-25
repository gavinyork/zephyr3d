import type { Nullable } from '@zephyr3d/base';
import type { SceneNode } from '@zephyr3d/scene';

export type SpringColliderType = 'sphere' | 'capsule' | 'plane';
export type SpringSolverType = 'xpbd' | 'verlet';
export const SPRING_EDITOR_TYPE = 'springtest';

export type SpringChainData = {
  startBone?: string;
  endBone?: string;
};

export type SpringColliderData = {
  type?: SpringColliderType;
  enabled?: boolean;
  bone?: string;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  endOffsetX?: number;
  endOffsetY?: number;
  endOffsetZ?: number;
  radius?: number;
  normalX?: number;
  normalY?: number;
  normalZ?: number;
};

export type SpringScriptConfigData = {
  __editorPluginType?: string;
  enabled?: boolean;
  chainDamping?: number;
  chainStiffness?: number;
  gravityX?: number;
  gravityY?: number;
  gravityZ?: number;
  iterations?: number;
  enableInertialForces?: boolean;
  centrifugalScale?: number;
  coriolisScale?: number;
  solver?: SpringSolverType;
  poseFollow?: number;
  poseFollowRoot?: number;
  poseFollowTip?: number;
  poseFollowExponent?: number;
  maxPoseOffset?: number;
  maxPoseOffsetRoot?: number;
  maxPoseOffsetTip?: number;
  modifierWeight?: number;
  chains?: SpringChainData[];
  colliders?: SpringColliderData[];
};

export function isSpringScript(script: string) {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return /(^|\/)springtest(\.ts|\.js)?$/.test(normalized);
}

export function hasSpringMarker(host: Nullable<SceneNode>) {
  return String((host as any)?.scriptConfig?.__editorPluginType ?? '').trim() === SPRING_EDITOR_TYPE;
}

export function hasScriptAttachment(host: Nullable<SceneNode>) {
  return String((host as any)?.script ?? '').trim().length > 0;
}

export function isSpringHost(host: Nullable<SceneNode>) {
  return (
    !!host &&
    hasScriptAttachment(host) &&
    (hasSpringMarker(host) || isSpringScript((host as any).script ?? ''))
  );
}
