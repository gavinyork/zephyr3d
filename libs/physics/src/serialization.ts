import { Vector3 } from '@zephyr3d/base';
import type { SerializableClass, ResourceManager } from '@zephyr3d/scene';
import { defineProps } from '@zephyr3d/scene';
import { RigidBody } from './rigid_body';
import { Collider, type ColliderShape } from './collider';
import { Joint, type JointMotorMode, type JointType } from './joint';
import { CharacterController } from './character';
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
        },
        {
          name: 'LockTranslationX',
          description: 'Stops the body sliding along the world X axis, e.g. to keep a 2.5D game on its plane',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockTranslationX;
          },
          set(this: RigidBody, value) {
            this.lockTranslationX = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LockTranslationY',
          description: 'Stops the body sliding along the world Y axis, e.g. to keep a 2.5D game on its plane',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockTranslationY;
          },
          set(this: RigidBody, value) {
            this.lockTranslationY = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LockTranslationZ',
          description: 'Stops the body sliding along the world Z axis, e.g. to keep a 2.5D game on its plane',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockTranslationZ;
          },
          set(this: RigidBody, value) {
            this.lockTranslationZ = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LockRotationX',
          description:
            'Stops the body tipping or spinning about the world X axis, e.g. to keep a character upright',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockRotationX;
          },
          set(this: RigidBody, value) {
            this.lockRotationX = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LockRotationY',
          description:
            'Stops the body tipping or spinning about the world Y axis, e.g. to keep a character upright',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockRotationY;
          },
          set(this: RigidBody, value) {
            this.lockRotationY = value.bool[0];
          },
          isHidden(this: RigidBody) {
            return this.motionType !== 'dynamic';
          }
        },
        {
          name: 'LockRotationZ',
          description:
            'Stops the body tipping or spinning about the world Z axis, e.g. to keep a character upright',
          type: 'bool',
          default: false,
          get(this: RigidBody, value) {
            value.bool[0] = this.lockRotationZ;
          },
          set(this: RigidBody, value) {
            this.lockRotationZ = value.bool[0];
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
  const usesRadius = (c: Collider) => c.shape === 'sphere' || c.shape === 'capsule' || c.shape === 'cylinder';
  const usesMesh = (c: Collider) => c.shape === 'mesh' || c.shape === 'convex';
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
              labels: ['Box', 'Sphere', 'Capsule', 'Cylinder', 'Mesh', 'Convex hull', 'Terrain'],
              values: ['box', 'sphere', 'capsule', 'cylinder', 'mesh', 'convex', 'terrain']
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
          name: 'MeshLod',
          description:
            'Which level of detail of the mesh to collide with; higher levels are rougher but cheaper. 0 is the full mesh',
          type: 'int',
          default: 0,
          options: { minValue: 0, maxValue: 16 },
          get(this: Collider, value) {
            value.num[0] = this.meshLod;
          },
          set(this: Collider, value) {
            this.meshLod = value.num[0];
          },
          isHidden(this: Collider) {
            return !usesMesh(this);
          }
        },
        {
          name: 'TerrainResolution',
          description:
            'Spacing of the ground samples in height map texels; larger values follow bumps less closely but use less memory',
          type: 'int',
          default: 1,
          options: { minValue: 1, maxValue: 16 },
          get(this: Collider, value) {
            value.num[0] = this.terrainResolution;
          },
          set(this: Collider, value) {
            this.terrainResolution = value.num[0];
          },
          isHidden(this: Collider) {
            return this.shape !== 'terrain';
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
          },
          isHidden(this: Collider) {
            return this.shape === 'terrain';
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
        },
        {
          name: 'Layer',
          description:
            'Collision layer 0-15; the world decides which layers pass through each other, and queries can skip layers',
          type: 'int',
          default: 0,
          options: { minValue: 0, maxValue: 15 },
          get(this: Collider, value) {
            value.num[0] = this.layer;
          },
          set(this: Collider, value) {
            this.layer = value.num[0];
          }
        }
      ]);
    }
  };
}

function getJointClass(): SerializableClass {
  return {
    ctor: Joint,
    name: 'Joint',
    getProps() {
      return defineProps([
        {
          name: 'Type',
          description:
            'What the two bodies may do: stay together, swing like a door, slide like a drawer, swivel like a shoulder, hang on a rope, or bounce on a spring',
          type: 'string',
          default: 'hinge',
          options: {
            enum: {
              labels: ['Fixed', 'Hinge', 'Slider', 'Ball', 'Rope', 'Spring'],
              values: ['fixed', 'hinge', 'slider', 'ball', 'rope', 'spring']
            }
          },
          get(this: Joint, value) {
            value.str[0] = this.type;
          },
          set(this: Joint, value) {
            this.type = value.str[0] as JointType;
          }
        },
        {
          name: 'ConnectedBody',
          description:
            'The object at the other end of the joint; leave empty to fix it to a point in the world',
          type: 'string',
          default: '',
          options: { sceneNode: { kind: 'node' } },
          get(this: Joint, value) {
            value.str[0] = this.connectedBodyId;
          },
          set(this: Joint, value) {
            this.connectedBodyId = value.str[0] ?? '';
          }
        },
        {
          name: 'Anchor',
          description: 'Moves the pivot away from this node, to where the two objects meet',
          type: 'vec3',
          default: [0, 0, 0],
          get(this: Joint, value) {
            value.num[0] = this.anchor.x;
            value.num[1] = this.anchor.y;
            value.num[2] = this.anchor.z;
          },
          set(this: Joint, value) {
            this.anchor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ConnectedAnchor',
          description:
            'Where a rope or spring is tied at the other end: a point on the connected object, or in the world when there is none',
          type: 'vec3',
          default: [0, 0, 0],
          get(this: Joint, value) {
            value.num[0] = this.connectedAnchor.x;
            value.num[1] = this.connectedAnchor.y;
            value.num[2] = this.connectedAnchor.z;
          },
          set(this: Joint, value) {
            this.connectedAnchor = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isHidden(this: Joint) {
            return this.type !== 'rope' && this.type !== 'spring';
          }
        },
        {
          name: 'Axis',
          description: "Direction, in this node's space, a hinge turns about or a slider moves along",
          type: 'vec3',
          default: [0, 1, 0],
          get(this: Joint, value) {
            value.num[0] = this.axis.x;
            value.num[1] = this.axis.y;
            value.num[2] = this.axis.z;
          },
          set(this: Joint, value) {
            this.axis = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isHidden(this: Joint) {
            return this.type !== 'hinge' && this.type !== 'slider';
          }
        },
        {
          name: 'CollideConnected',
          description:
            'Lets the two joined objects bump into each other; off so a door does not catch on its frame',
          type: 'bool',
          default: false,
          get(this: Joint, value) {
            value.bool[0] = this.collideConnected;
          },
          set(this: Joint, value) {
            this.collideConnected = value.bool[0];
          }
        },
        {
          name: 'LimitsEnabled',
          description: 'Stops the joint turning or sliding past set limits',
          type: 'bool',
          default: false,
          get(this: Joint, value) {
            value.bool[0] = this.limitsEnabled;
          },
          set(this: Joint, value) {
            this.limitsEnabled = value.bool[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'hinge' && this.type !== 'slider' && this.type !== 'ball';
          }
        },
        {
          name: 'LowerLimit',
          description: 'How far a hinge may turn one way (degrees) or a slider move back (metres)',
          type: 'float',
          default: -45,
          get(this: Joint, value) {
            value.num[0] = this.lowerLimit;
          },
          set(this: Joint, value) {
            this.lowerLimit = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || !this.limitsEnabled;
          }
        },
        {
          name: 'UpperLimit',
          description: 'How far a hinge may turn the other way (degrees) or a slider move forward (metres)',
          type: 'float',
          default: 45,
          get(this: Joint, value) {
            value.num[0] = this.upperLimit;
          },
          set(this: Joint, value) {
            this.upperLimit = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || !this.limitsEnabled;
          }
        },
        {
          name: 'SwingLimit',
          description: 'How far a ball joint may tilt away from its axis, in degrees',
          type: 'float',
          default: 45,
          options: { minValue: 0, maxValue: 180 },
          get(this: Joint, value) {
            value.num[0] = this.swingLimit;
          },
          set(this: Joint, value) {
            this.swingLimit = value.num[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'ball' || !this.limitsEnabled;
          }
        },
        {
          name: 'TwistLimit',
          description: 'How far a ball joint may twist about its axis, in degrees',
          type: 'float',
          default: 45,
          options: { minValue: 0, maxValue: 180 },
          get(this: Joint, value) {
            value.num[0] = this.twistLimit;
          },
          set(this: Joint, value) {
            this.twistLimit = value.num[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'ball' || !this.limitsEnabled;
          }
        },
        {
          name: 'MotorMode',
          description: 'Drives a hinge or slider: to a steady speed, or to a set angle or position',
          type: 'string',
          default: 'off',
          options: {
            enum: { labels: ['Off', 'Speed', 'Position'], values: ['off', 'velocity', 'position'] }
          },
          get(this: Joint, value) {
            value.str[0] = this.motorMode;
          },
          set(this: Joint, value) {
            this.motorMode = value.str[0] as JointMotorMode;
          },
          isHidden(this: Joint) {
            return this.type !== 'hinge' && this.type !== 'slider';
          }
        },
        {
          name: 'MotorTarget',
          description:
            'Speed to turn or slide at, or angle or position to reach (degrees for hinges, metres for sliders)',
          type: 'float',
          default: 0,
          get(this: Joint, value) {
            value.num[0] = this.motorTarget;
          },
          set(this: Joint, value) {
            this.motorTarget = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || this.motorMode === 'off';
          }
        },
        {
          name: 'MotorStiffness',
          description: 'How firmly a position motor pulls to its target',
          type: 'float',
          default: 1000,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.motorStiffness;
          },
          set(this: Joint, value) {
            this.motorStiffness = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || this.motorMode !== 'position';
          }
        },
        {
          name: 'MotorDamping',
          description: 'How smoothly a motor settles; for a speed motor, how quickly it gets up to speed',
          type: 'float',
          default: 100,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.motorDamping;
          },
          set(this: Joint, value) {
            this.motorDamping = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || this.motorMode === 'off';
          }
        },
        {
          name: 'MotorMaxForce',
          description: 'Strongest push the motor can give; 0 for no limit',
          type: 'float',
          default: 0,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.motorMaxForce;
          },
          set(this: Joint, value) {
            this.motorMaxForce = value.num[0];
          },
          isHidden(this: Joint) {
            return (this.type !== 'hinge' && this.type !== 'slider') || this.motorMode === 'off';
          }
        },
        {
          name: 'Length',
          description: 'Longest a rope gets, or the length a spring settles at, in metres',
          type: 'float',
          default: 1,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.length;
          },
          set(this: Joint, value) {
            this.length = value.num[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'rope' && this.type !== 'spring';
          }
        },
        {
          name: 'Stiffness',
          description: 'How hard the spring pulls back when stretched',
          type: 'float',
          default: 100,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.stiffness;
          },
          set(this: Joint, value) {
            this.stiffness = value.num[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'spring';
          }
        },
        {
          name: 'Damping',
          description: 'How quickly the spring stops bouncing',
          type: 'float',
          default: 5,
          options: { minValue: 0 },
          get(this: Joint, value) {
            value.num[0] = this.damping;
          },
          set(this: Joint, value) {
            this.damping = value.num[0];
          },
          isHidden(this: Joint) {
            return this.type !== 'spring';
          }
        }
      ]);
    }
  };
}

function getCharacterControllerClass(): SerializableClass {
  return {
    ctor: CharacterController,
    name: 'CharacterController',
    getProps() {
      return defineProps([
        {
          name: 'Height',
          description: 'Height of the character, from its feet at this node',
          type: 'float',
          default: 1.8,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.height;
          },
          set(this: CharacterController, value) {
            this.height = value.num[0];
          }
        },
        {
          name: 'Radius',
          description: 'How wide the character is: radius of its body',
          type: 'float',
          default: 0.3,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.radius;
          },
          set(this: CharacterController, value) {
            this.radius = value.num[0];
          }
        },
        {
          name: 'SkinWidth',
          description:
            'Small gap kept around the character; too small and it snags in corners, too large and it floats',
          type: 'float',
          default: 0.02,
          options: { minValue: 0, maxValue: 0.5 },
          get(this: CharacterController, value) {
            value.num[0] = this.skinWidth;
          },
          set(this: CharacterController, value) {
            this.skinWidth = value.num[0];
          }
        },
        {
          name: 'SlopeLimit',
          description: 'Steepest slope it can walk up, in degrees',
          type: 'float',
          default: 45,
          options: { minValue: 0, maxValue: 90 },
          get(this: CharacterController, value) {
            value.num[0] = this.slopeLimit;
          },
          set(this: CharacterController, value) {
            this.slopeLimit = value.num[0];
          }
        },
        {
          name: 'SlideSlope',
          description: 'Slopes steeper than this, in degrees, make it slide down',
          type: 'float',
          default: 30,
          options: { minValue: 0, maxValue: 90 },
          get(this: CharacterController, value) {
            value.num[0] = this.slideSlope;
          },
          set(this: CharacterController, value) {
            this.slideSlope = value.num[0];
          }
        },
        {
          name: 'StepHeight',
          description: 'Highest step it walks up without jumping; 0 to never step up',
          type: 'float',
          default: 0.3,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.stepHeight;
          },
          set(this: CharacterController, value) {
            this.stepHeight = value.num[0];
          }
        },
        {
          name: 'StepMinWidth',
          description: 'Narrowest ledge it will step onto',
          type: 'float',
          default: 0.2,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.stepMinWidth;
          },
          set(this: CharacterController, value) {
            this.stepMinWidth = value.num[0];
          }
        },
        {
          name: 'SnapToGround',
          description:
            'Keeps it on the ground walking down slopes and steps, up to this drop; 0 to let it leave the ground',
          type: 'float',
          default: 0.2,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.snapToGround;
          },
          set(this: CharacterController, value) {
            this.snapToGround = value.num[0];
          }
        },
        {
          name: 'PushBodies',
          description: 'Lets the character shove loose objects it walks into',
          type: 'bool',
          default: true,
          get(this: CharacterController, value) {
            value.bool[0] = this.pushBodies;
          },
          set(this: CharacterController, value) {
            this.pushBodies = value.bool[0];
          }
        },
        {
          name: 'CharacterMass',
          description: 'How heavy the character is when shoving objects, in kilograms',
          type: 'float',
          default: 70,
          options: { minValue: 0 },
          get(this: CharacterController, value) {
            value.num[0] = this.characterMass;
          },
          set(this: CharacterController, value) {
            this.characterMass = value.num[0];
          }
        },
        {
          name: 'Layer',
          description: 'Collision layer 0-15 of the character',
          type: 'int',
          default: 0,
          options: { minValue: 0, maxValue: 15 },
          get(this: CharacterController, value) {
            value.num[0] = this.layer;
          },
          set(this: CharacterController, value) {
            this.layer = value.num[0];
          }
        }
      ]);
    }
  };
}

/** Registers the physics components' serializable classes. @internal */
export function registerPhysicsSerializableClasses(manager: ResourceManager) {
  manager.registerClass(getRigidBodyClass());
  manager.registerClass(getColliderClass());
  manager.registerClass(getJointClass());
  manager.registerClass(getCharacterControllerClass());
}
