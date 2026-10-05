import { Vector3 } from '@zephyr3d/base';
import type { SerializableClass, ResourceManager } from '@zephyr3d/scene';
import { defineProps } from '@zephyr3d/scene';
import { RigidBody } from './rigid_body';
import { Collider, type ColliderShape } from './collider';
import type { MotionType } from './backend/types';

function getRigidBodyClass(): SerializableClass {
  return {
    ctor: RigidBody,
    name: 'RigidBody',
    getProps() {
      return defineProps([
        {
          name: 'MotionType',
          description:
            'Dynamic: falls and gets pushed around. Kinematic: follows its node and pushes others aside. Static: never moves',
          type: 'string',
          default: 'dynamic',
          options: {
            enum: { labels: ['Dynamic', 'Kinematic', 'Static'], values: ['dynamic', 'kinematic', 'static'] }
          },
          get(this: RigidBody, value) {
            value.str[0] = this.motionType;
          },
          set(this: RigidBody, value) {
            this.motionType = value.str[0] as MotionType;
          }
        },
        {
          name: 'Mass',
          description: 'Weight in kilograms; heavier bodies push lighter ones aside and are harder to stop',
          type: 'float',
          default: 1,
          options: { minValue: 0.001, maxValue: 10000 },
          get(this: RigidBody, value) {
            value.num[0] = this.mass;
          },
          set(this: RigidBody, value) {
            this.mass = value.num[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LinearDamping',
          description: 'Slows the body down as if moving through air or water; 0 keeps it going',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 10 },
          get(this: RigidBody, value) {
            value.num[0] = this.linearDamping;
          },
          set(this: RigidBody, value) {
            this.linearDamping = value.num[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'AngularDamping',
          description: 'Makes spinning die down; higher values stop rolling objects sooner',
          type: 'float',
          default: 0.05,
          options: { minValue: 0, maxValue: 10 },
          get(this: RigidBody, value) {
            value.num[0] = this.angularDamping;
          },
          set(this: RigidBody, value) {
            this.angularDamping = value.num[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'GravityScale',
          description: 'How strongly gravity pulls this body: 0 floats, 1 falls normally, negative rises',
          type: 'float',
          default: 1,
          options: { minValue: -10, maxValue: 10 },
          get(this: RigidBody, value) {
            value.num[0] = this.gravityScale;
          },
          set(this: RigidBody, value) {
            this.gravityScale = value.num[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'CCD',
          description: 'Stops small, fast objects from passing through thin walls, at some cost',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.ccd;
          },
          set(this: RigidBody, value) {
            this.ccd = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'CanSleep',
          description: 'Lets the body stop being simulated once it comes to rest, saving time',
          type: 'bool',
          default: true,
          get(this: RigidBody, value) {
            value.bool[0] = this.canSleep;
          },
          set(this: RigidBody, value) {
            this.canSleep = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        }
      ]);
    }
  };
}

function getColliderClass(): SerializableClass {
  const usesRadius = (c: Collider) => c.shape !== 'box';
  const usesHeight = (c: Collider) => c.shape === 'capsule' || c.shape === 'cylinder';
  return {
    ctor: Collider,
    name: 'Collider',
    getProps() {
      return defineProps([
        {
          name: 'Shape',
          description: 'Outline used for collisions; pick the simplest one that fits the object',
          type: 'string',
          default: 'box',
          options: {
            enum: {
              labels: ['Box', 'Sphere', 'Capsule', 'Cylinder'],
              values: ['box', 'sphere', 'capsule', 'cylinder']
            }
          },
          get(this: Collider, value) {
            value.str[0] = this.shape;
          },
          set(this: Collider, value) {
            this.shape = value.str[0] as ColliderShape;
          }
        },
        {
          name: 'Size',
          description: 'Width, height and depth of the box',
          type: 'vec3',
          default: [1, 1, 1],
          options: { minValue: 0 },
          get(this: Collider, value) {
            value.num[0] = this.size.x;
            value.num[1] = this.size.y;
            value.num[2] = this.size.z;
          },
          set(this: Collider, value) {
            this.size = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isHidden(this: Collider) {
            return this.shape !== 'box';
          }
        },
        {
          name: 'Radius',
          description: 'Radius of the sphere, capsule or cylinder',
          type: 'float',
          default: 0.5,
          options: { minValue: 0 },
          get(this: Collider, value) {
            value.num[0] = this.radius;
          },
          set(this: Collider, value) {
            this.radius = value.num[0];
          },
          isHidden(this: Collider) {
            return !usesRadius(this);
          }
        },
        {
          name: 'Height',
          description: "Total height of the capsule or cylinder along the object's up axis",
          type: 'float',
          default: 2,
          options: { minValue: 0 },
          get(this: Collider, value) {
            value.num[0] = this.height;
          },
          set(this: Collider, value) {
            this.height = value.num[0];
          },
          isHidden(this: Collider) {
            return !usesHeight(this);
          }
        },
        {
          name: 'Offset',
          description: "Moves the shape away from the object's origin, to line it up with the visible mesh",
          type: 'vec3',
          default: [0, 0, 0],
          get(this: Collider, value) {
            value.num[0] = this.offset.x;
            value.num[1] = this.offset.y;
            value.num[2] = this.offset.z;
          },
          set(this: Collider, value) {
            this.offset = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Friction',
          description: 'Grip against sliding: 0 is ice, around 1 is rubber',
          type: 'float',
          default: 0.5,
          options: { minValue: 0, maxValue: 2 },
          get(this: Collider, value) {
            value.num[0] = this.friction;
          },
          set(this: Collider, value) {
            this.friction = value.num[0];
          }
        },
        {
          name: 'Restitution',
          description: 'Bounciness: 0 lands dead, 1 bounces back to the height it fell from',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 1 },
          get(this: Collider, value) {
            value.num[0] = this.restitution;
          },
          set(this: Collider, value) {
            this.restitution = value.num[0];
          }
        },
        {
          name: 'IsTrigger',
          description: 'Detects things entering it without blocking them, e.g. for pickup or alarm zones',
          type: 'bool',
          default: false,
          get(this: Collider, value) {
            value.bool[0] = this.isTrigger;
          },
          set(this: Collider, value) {
            this.isTrigger = value.bool[0];
          }
        }
      ]);
    }
  };
}

/**
 * Registers the physics components with a serialization manager, so scenes
 * containing them can be saved and loaded.
 *
 * @public
 */
export function registerPhysicsClasses(manager: ResourceManager) {
  manager.registerClass(getRigidBodyClass());
  manager.registerClass(getColliderClass());
}
