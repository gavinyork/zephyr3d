import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  createSphereCollider,
  createCapsuleCollider,
  createPlaneCollider,
  SpringModifier,
  SpringSystem,
  SpringChain
} from '@zephyr3d/scene';

export default class extends RuntimeScript {
  onAttached(host) {
    const root = host;
    const config = root?.scriptConfig;
    if (!config || !config.enabled) {
      return;
    }
    const skeleton = root.animationSet?.skeletons?.[0]?.get();
    if (!skeleton) {
      return;
    }
    const parseVec3 = (value, fallback) => {
      if (Array.isArray(value) && value.length >= 3) {
        return new Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
      }
      return fallback.clone();
    };
    const COLLIDER_PANEL_SCALE = 10;
    const scaleCapsuleAroundCenter = (start, end, scale) => {
      const center = Vector3.scale(Vector3.add(start, end, new Vector3()), 0.5, new Vector3());
      const half = Vector3.scale(Vector3.sub(end, start, new Vector3()), 0.5 * scale, new Vector3());
      return {
        start: Vector3.sub(center, half, new Vector3()),
        end: Vector3.add(center, half, new Vector3())
      };
    };
    const hierarchyColliders = [];
    root.iterate((node) => {
      const c = node?.metaData?.springCollider;
      if (!c || typeof c !== 'object') {
        return false;
      }
      if (c.type !== 'sphere' && c.type !== 'capsule' && c.type !== 'plane') {
        return false;
      }
      hierarchyColliders.push({ node, config: c });
      return false;
    });
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const chain = SpringChain.fromBoneChain(chainStart, chainEnd, {
        damping: config.chainDamping,
        stiffness: config.chainStiffness
      });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(config.gravityX, config.gravityY, config.gravityZ),
        iterations: config.iterations,
        enableInertialForces: config.enableInertialForces,
        centrifugalScale: config.centrifugalScale,
        coriolisScale: config.coriolisScale,
        solver: config.solver,
        poseFollow: config.poseFollow,
        poseFollowRoot: config.poseFollowRoot,
        poseFollowTip: config.poseFollowTip,
        poseFollowExponent: config.poseFollowExponent,
        maxPoseOffset: config.maxPoseOffset,
        maxPoseOffsetRoot: config.maxPoseOffsetRoot,
        maxPoseOffsetTip: config.maxPoseOffsetTip
      });
      if (hierarchyColliders.length > 0) {
        for (const item of hierarchyColliders) {
          const colliderConfig = item.config;
          let collider = null;
          if (colliderConfig.type === 'sphere') {
            collider = createSphereCollider(
              parseVec3(colliderConfig.offset, Vector3.zero()),
              Math.max(0, (Number(colliderConfig.radius) || 0.15) * COLLIDER_PANEL_SCALE),
              item.node
            );
            // Keep collider radius authored by node scale in editor gizmo workflow.
            collider.localRadiusScaleRef = 1;
          } else if (colliderConfig.type === 'capsule') {
            const startOffset = parseVec3(colliderConfig.offset, Vector3.zero());
            const endOffset = parseVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0));
            const scaledCapsule = scaleCapsuleAroundCenter(startOffset, endOffset, COLLIDER_PANEL_SCALE);
            collider = createCapsuleCollider(
              scaledCapsule.start,
              scaledCapsule.end,
              Math.max(0, (Number(colliderConfig.radius) || 0.1) * COLLIDER_PANEL_SCALE),
              item.node
            );
            // Keep collider radius authored by node scale in editor gizmo workflow.
            collider.localRadiusScaleRef = 1;
          } else if (colliderConfig.type === 'plane') {
            collider = createPlaneCollider(
              parseVec3(colliderConfig.offset, Vector3.zero()),
              parseVec3(colliderConfig.normal, Vector3.axisPY()),
              item.node
            );
          }
          if (collider) {
            collider.enabled = colliderConfig.enabled !== false;
            springSystem.addCollider(collider);
          }
        }
      } else if ((config.colliders ?? []).length > 0) {
        const colliderConfigs = config.colliders ?? [];
        for (const colliderConfig of colliderConfigs) {
          const attachNode = root.findNodeByName(colliderConfig.bone) ?? root;
          let collider = null;
          if (colliderConfig.type === 'sphere') {
            collider = createSphereCollider(
              new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
              Math.max(0, Number(colliderConfig.radius) * COLLIDER_PANEL_SCALE),
              attachNode
            );
          } else if (colliderConfig.type === 'capsule') {
            const startOffset = new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ);
            const endOffset = new Vector3(
              colliderConfig.endOffsetX,
              colliderConfig.endOffsetY,
              colliderConfig.endOffsetZ
            );
            const scaledCapsule = scaleCapsuleAroundCenter(startOffset, endOffset, COLLIDER_PANEL_SCALE);
            collider = createCapsuleCollider(
              scaledCapsule.start,
              scaledCapsule.end,
              Math.max(0, Number(colliderConfig.radius) * COLLIDER_PANEL_SCALE),
              attachNode
            );
          } else if (colliderConfig.type === 'plane') {
            collider = createPlaneCollider(
              new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
              new Vector3(colliderConfig.normalX, colliderConfig.normalY, colliderConfig.normalZ),
              attachNode
            );
          }
          if (collider) {
            collider.enabled = colliderConfig.enabled !== false;
            springSystem.addCollider(collider);
          }
        }
      } else {
        // Legacy fallback: keep old single-sphere config working.
        springSystem.addCollider(
          createSphereCollider(
            new Vector3(config.colliderOffsetX, config.colliderOffsetY, config.colliderOffsetZ),
            config.colliderRadius,
            root
          )
        );
      }
      const springModifier = new SpringModifier(springSystem, config.modifierWeight);
      skeleton.modifiers.push(springModifier);
    }
  }
}
