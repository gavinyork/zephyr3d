import { mat4, quat, vec3, vec4 } from 'gl-matrix';

import { Geometry, Gpu, Mesh, ShaderProgram } from './gpu';
import { Transform } from './transform';
import { createGrid } from './mesh';
import { Camera } from './camera';
import { vs, fs } from './programs/mesh';
import { FloatingBody, OceanFieldBuoyancy } from '../ocean';

export class Gizmos {
  private readonly wiredSphereGeometry: Geometry;
  private readonly xzCircleGeometry: Geometry;
  private readonly gridGeometry: Geometry;
  private readonly patchGeometry: Geometry;
  private readonly axesGeometry: Geometry;
  private readonly transform = new Transform();
  private readonly meshShader: ShaderProgram;

  constructor(private readonly gpu: Gpu) {
    this.meshShader = this.gpu.createShaderProgram(vs, fs);
    this.gridGeometry = this.gpu.createGeometry(
      createGrid(5.0),
      WebGL2RenderingContext.LINES
    );
    this.patchGeometry = this.gpu.createGeometry(
      createPatchMesh(4),
      WebGL2RenderingContext.LINES
    );
    this.wiredSphereGeometry = this.gpu.createGeometry(
      createWiredSphereMesh(32),
      WebGL2RenderingContext.LINES
    );
    this.axesGeometry = this.gpu.createGeometry(
      createAxesMesh(),
      WebGL2RenderingContext.LINES
    );
    this.xzCircleGeometry = this.gpu.createGeometry(
      createXZCircleMesh(),
      WebGL2RenderingContext.LINES
    );
  }

  drawGrid(camera: Camera) {
    this.drawInternal(
      camera,
      this.gridGeometry,
      vec4.fromValues(1.0, 1.0, 1.0, 0.0),
      vec3.create(),
      quat.create(),
      vec3.fromValues(1.0, 1.0, 1.0)
    );
  }

  drawSphere(
    camera: Camera,
    position: vec3,
    size: number = 1.0,
    color: vec4 = vec4.fromValues(0.5, 1.0, 0.5, 0.0)
  ): void {
    this.drawInternal(
      camera,
      this.wiredSphereGeometry,
      color,
      position,
      quat.create(),
      vec3.fromValues(size, size, size)
    );
  }

  drawXZCircle(
    camera: Camera,
    position: vec3,
    size: number = 1.0,
    color: vec4 = vec4.fromValues(0.5, 1.0, 0.5, 0.0)
  ): void {
    this.drawInternal(
      camera,
      this.xzCircleGeometry,
      color,
      position,
      quat.create(),
      vec3.fromValues(size, size, size)
    );
  }

  drawPatch(camera: Camera, patch: vec3[], yOffset: number = 0.1): void {
    const buffer = Float32Array.from(patch.map((e) => [...e]).flat());
    this.gpu.updateGeometry(this.patchGeometry, buffer);

    this.drawInternal(
      camera,
      this.patchGeometry,
      vec4.fromValues(1.0, 1.0, 1.0, 0.0),
      vec3.fromValues(0.0, yOffset, 0.0),
      quat.create(),
      vec3.fromValues(1.0, 1.0, 1.0)
    );
  }

  drawAxes(
    camera: Camera,
    position: vec3,
    rotation: quat = quat.create(),
    size: number = 1.0,
    color: vec4 = vec4.fromValues(1.0, 1.0, 1.0, 0.0)
  ): void {
    this.gpu.context.disable(WebGL2RenderingContext.DEPTH_TEST);
    this.drawInternal(
      camera,
      this.axesGeometry,
      color,
      position,
      rotation,
      vec3.fromValues(size, size, size)
    );
    this.gpu.context.enable(WebGL2RenderingContext.DEPTH_TEST);
  }

  drawGeometry(
    camera: Camera,
    geometry: Geometry,
    position: vec3,
    rotation: quat = quat.create(),
    size: number = 1.0,
    color: vec4 = vec4.fromValues(0.75, 0.75, 0.75, 1.0)
  ) {
    this.drawInternal(
      camera,
      geometry,
      color,
      position,
      rotation,
      vec3.fromValues(size, size, size)
    );
  }

  drawFloatingBody(
    camera: Camera,
    body: FloatingBody,
    boyancy: OceanFieldBuoyancy,
    geometry?: Geometry
  ): void {
    const position = vec3.create();
    const rotation = quat.create();

    mat4.getTranslation(position, body.body.transform);
    mat4.getRotation(rotation, body.body.transform);

    this.drawAxes(camera, position, rotation);
    if (geometry) {
      this.drawGeometry(camera, geometry, position, rotation);
    }

    if (boyancy['sampled']) {
      this.gpu.context.disable(WebGL2RenderingContext.DEPTH_TEST);
      const startIndex = boyancy['bodies']
        .slice(0, boyancy['bodies'].indexOf(body))
        .reduce((acc, curr) => acc + curr.floaters.length, 0);
      const endIndex = startIndex + body.floaters.length;

      const bodyWorld = boyancy['world'].slice(startIndex, endIndex);
      const bodySampled = boyancy['sampled'].slice(startIndex, endIndex);

      bodyWorld.forEach((world, i) => {
        const sampled = bodySampled[i];
        const submerged = sampled?.[1] >= world?.[1];
        const color = !submerged
          ? vec4.fromValues(0.5, 1.0, 0.5, 0.0)
          : vec4.fromValues(1.0, 1.0, 0.5, 0.0);

        this.drawSphere(camera, world, 0.1, color);
        if (sampled && submerged) {
          this.drawXZCircle(
            camera,
            sampled,
            0.1,
            vec4.fromValues(1.0, 1.25, 1.25, 0.0)
          );
        }
      });
      this.gpu.context.enable(WebGL2RenderingContext.DEPTH_TEST);
    }
  }

  private drawInternal(
    camera: Camera,
    geometry: Geometry,
    color: vec4,
    position: vec3,
    rotation: quat,
    scaling: vec3
  ) {
    this.transform.reset();
    this.transform.position = position;
    this.transform.rotation = rotation;
    this.transform.scale = scaling;

    this.gpu.setProgram(this.meshShader);
    this.gpu.setProgramVariable(
      this.meshShader,
      'worldMat',
      'mat4',
      this.transform.transform
    );
    this.gpu.setProgramVariable(
      this.meshShader,
      'viewMat',
      'mat4',
      camera.view
    );
    this.gpu.setProgramVariable(
      this.meshShader,
      'projMat',
      'mat4',
      camera.projection
    );
    this.gpu.setProgramVariable(
      this.meshShader,
      'pos',
      'vec3',
      camera.position
    );
    this.gpu.setProgramVariable(this.meshShader, 'albedo', 'vec4', color);
    this.gpu.drawGeometry(geometry);
  }
}

const createPatchMesh = (resolution: number): Mesh => {
  const indices: number[] = [];
  const points: vec3[] = [];
  const colors: vec3[] = [];

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (i < resolution - 1 && j < resolution - 1) {
        const i0 = i * resolution + j;
        const i1 = i * resolution + j + 1;
        const i2 = (i + 1) * resolution + j + 1;
        const i3 = (i + 1) * resolution + j;
        indices.push(i0, i1, i1, i2, i2, i3, i3, i0);
      }

      points.push(vec3.create());
      if (i === 0 || j === 0 || i === resolution - 1 || j === resolution - 1) {
        colors.push(vec3.fromValues(1.0, 1.0, 0.0));
      } else {
        colors.push(vec3.fromValues(1.0, 0.5, 0.0));
      }
    }
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 12,
      },
      {
        semantics: 'color',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 2,
        offset: 12 * resolution ** 2,
        stride: 12,
      },
    ],

    vertexData: Float32Array.from(
      points
        .concat(colors)
        .map((v) => [...v])
        .flat()
    ),
    indexData: Uint32Array.from(indices),
  };
};

const createWiredSphereMesh = (subdivisions: number = 32): Mesh => {
  let phi = 0.0;
  const dPhi = (Math.PI * 2.0) / subdivisions;
  const vertices = new Array(subdivisions * 3);
  const indices = [];

  for (let i = 0; i < subdivisions; i++, phi += dPhi) {
    const cosPhi = Math.cos(phi),
      sinPhi = Math.sin(phi);
    const planes = [
      [cosPhi, 0.0, sinPhi],
      [cosPhi, sinPhi, 0.0],
      [0.0, cosPhi, sinPhi],
    ];

    for (let j = 0; j < 3; j++) {
      const index = subdivisions * j + i;
      vertices[index] = [...planes[j], 1.0, 1.0, 1.0];

      indices.push(index);
      if (i === subdivisions - 1) {
        indices.push(subdivisions * j);
      } else {
        indices.push(index + 1);
      }
    }
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 24,
      },
      {
        semantics: 'color',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 2,
        offset: 12,
        stride: 24,
      },
    ],
    vertexData: Float32Array.from(vertices.flat()),
    indexData: Uint32Array.from(indices),
  };
};

const createAxesMesh = (): Mesh => {
  const red = [1.0, 0.0, 0.0];
  const green = [0.0, 1.0, 0.0];
  const blue = [0.0, 0.0, 1.0];

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 24,
      },
      {
        semantics: 'color',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 2,
        offset: 12,
        stride: 24,
      },
    ],
    vertexData: new Float32Array([
      0.0,
      0.0,
      0.0,
      ...red,
      1.0,
      0.0,
      0.0,
      ...red,

      0.0,
      0.0,
      0.0,
      ...green,
      0.0,
      1.0,
      0.0,
      ...green,

      0.0,
      0.0,
      0.0,
      ...blue,
      0.0,
      0.0,
      1.0,
      ...blue,
    ]),
    indexData: Uint32Array.from([0, 1, 2, 3, 4, 5]),
  };
};

const createXZCircleMesh = (subdivisions: number = 32): Mesh => {
  let phi = 0.0;
  const dPhi = (Math.PI * 2.0) / subdivisions;
  const vertices = new Array(subdivisions);
  const indices = [];

  for (let i = 0; i < subdivisions; i++, phi += dPhi) {
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    vertices[i] = [cosPhi, 0.0, sinPhi, 1.0, 1.0, 1.0];

    indices.push(i);
    if (i === subdivisions - 1) {
      indices.push(0);
    } else {
      indices.push(i + 1);
    }
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 24,
      },
      {
        semantics: 'color',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 2,
        offset: 12,
        stride: 24,
      },
    ],
    vertexData: Float32Array.from(vertices.flat()),
    indexData: Uint32Array.from(indices),
  };
};
