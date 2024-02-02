import { vec3, quat } from 'gl-matrix';

import { Body } from './body';
import { MassDistributionInterface, IntegratorInterface } from '../interfaces';
import { EulerIntegrator } from './euler-integrator';

export class World {
  public readonly bodies = new Set<Body>();
  public state: Float32Array;
  public stateDerivative: Float32Array;

  constructor(
    public readonly gravity = vec3.fromValues(0.0, -9.8, 0.0),
    private readonly damping = 0.0,
    private readonly angularDamping = 0.0,
    private readonly integrator: IntegratorInterface = new EulerIntegrator()
  ) {}

  createBody(
    mass: number,
    shape: MassDistributionInterface,
    position = vec3.create(),
    orientation = quat.create()
  ) {
    const Ibody = shape.getInertiaTensor(mass);
    const body = new Body(mass, Ibody);
    body.position = position;
    body.rotation = orientation;
    this.bodies.add(body);

    this.state = new Float32Array(Body.STATE_SIZE * this.bodies.size);
    this.stateDerivative = new Float32Array(Body.STATE_SIZE * this.bodies.size);

    return body;
  }

  destroyBody(body: Body) {
    this.bodies.delete(body);
  }

  integrate(dt: number) {
    this.applyGravity();
    this.applyDamping();
    this.serialize();

    this.integrator.integrate(this.state, this.state, this.stateDerivative, dt);

    this.clearForces();
    this.deserialize();
  }

  private applyGravity() {
    const force = vec3.create();
    this.bodies.forEach((body) => {
      if (!Number.isFinite(body.mass)) {
        return;
      }
      body.applyForce(
        vec3.scale(force, this.gravity, body.mass),
        vec3.fromValues(0, 0, 0)
      );
    });
  }

  private applyDamping() {
    this.bodies.forEach((body) => {
      if (!Number.isFinite(body.mass)) {
        return;
      }
      if (this.damping) {
        body.applyForce(
          vec3.scale(vec3.create(), body.velocity, -this.damping)
        );
      }
      if (this.angularDamping) {
        body.applyTorque(
          vec3.scale(vec3.create(), body.omega, -this.angularDamping)
        );
      }
    });
  }

  private clearForces() {
    this.bodies.forEach((body) => body.clearForces());
  }

  private serialize() {
    let offset = 0;
    for (let body of this.bodies) {
      body.serializeState(this.state, offset);
      body.serializeStateDerivative(this.stateDerivative, offset);
      offset += Body.STATE_SIZE;
    }
  }

  private deserialize() {
    let offset = 0;
    for (let body of this.bodies) {
      body.deserializeState(this.state, offset);
      offset += Body.STATE_SIZE;
    }
  }
}
