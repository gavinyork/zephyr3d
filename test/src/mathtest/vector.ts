import type { Vector2 } from '@zephyr3d/base';
import { Vector3, Vector4, Quaternion, Matrix3x3, Matrix4x4 } from '@zephyr3d/base';
import { rand, randInt, randNonZero, numberEquals } from './common';
import { Scene, SceneNode } from '@zephyr3d/scene';

type VectorType = Vector2 | Vector3 | Vector4;

interface VectorConstructor {
  new (...args: any[]): VectorType;
  add: Function;
  sub: Function;
  mul: Function;
  div: Function;
  scale: Function;
  dot?: Function;
  cross?: Function;
  normalize?: Function;
}

type MatrixType = Matrix3x3 | Matrix4x4;
interface MatrixConstructor {
  new (...args: any[]): MatrixType;
  add: Function;
  sub: Function;
  mul: Function;
  div: Function;
  scale: Function;
  identity: Function;
  invert: Function;
  multiply: Function;
  translation?: Function;
  scaling?: Function;
  rotationX: Function;
  rotationY: Function;
  rotationZ: Function;
  rotation: Function;
  translateRight?: Function;
  translateLeft?: Function;
  scaleRight?: Function;
  scaleLeft?: Function;
  rotateRight?: Function;
  rotateLeft?: Function;
}

export function testVectorType(c: VectorConstructor, size: 2 | 3 | 4 | 16) {
  function randVec(): VectorType {
    const values = [randNonZero(), randNonZero(), randNonZero(), randNonZero()].slice(0, size);
    return new c(values);
  }

  describe(`Vector tests for ${(c as any).name} (size=${size})`, () => {
    test('constructor & copy & from array', () => {
      const v1 = new c();
      expect(v1.length).toBe(size);
      for (let i = 0; i < size; i++) {
        expect(v1[i]).toBe(0);
      }

      const v2 = randVec();
      const v3 = new c(v2);
      expect(v2.equalsTo(v3)).toBe(true);

      const values = [rand(), rand(), rand(), rand()].slice(0, size);
      const v4 = new c(values);
      for (let i = 0; i < size; i++) {
        expect(Math.abs(v4[i] - values[i]) < 0.01).toBe(true);
      }
    });

    test('add/sub/mul/div/scale', () => {
      const opAdd = (a: number, b: number) => a + b;
      const opSub = (a: number, b: number) => a - b;
      const opMul = (a: number, b: number) => a * b;
      const opDiv = (a: number, b: number) => a / b;

      const opList: [Function, Function, (a: number, b: number) => number, string][] = [
        [c.add, (c.prototype as any).addBy, opAdd, 'add'],
        [c.sub, (c.prototype as any).subBy, opSub, 'sub'],
        [c.mul, (c.prototype as any).mulBy, opMul, 'mul'],
        [c.div, (c.prototype as any).divBy, opDiv, 'div']
      ];

      for (const op of opList) {
        const v1 = randVec();
        const v2 = randVec();
        const v3 = new c();
        const v4 = op[0](v1, v2);
        op[0](v1, v2, v3);

        for (let i = 0; i < size; i++) {
          const t = op[2](v1[i], v2[i]);
          expect(Math.abs(t - v3[i]) < 0.01 && Math.abs(t - v4[i]) < 0.01).toBe(true);
        }

        op[1].bind(v1)(v2 as any);
        expect(v1.equalsTo(v3)).toBe(true);
      }

      const factor = rand();
      const v5 = randVec();
      const v6 = (c as any).scale(v5, factor);
      const v7 = new c();
      (c as any).scale(v5, factor, v7);
      for (let i = 0; i < size; i++) {
        const t = v5[i] * factor;
        expect(Math.abs(v6[i] - t) < 0.01 && Math.abs(v7[i] - t) < 0.01).toBe(true);
      }
      (v5 as any).scaleBy(factor);
      expect(v5.equalsTo(v6)).toBe(true);
    });

    if (c.normalize) {
      test('normalize', () => {
        const v1 = randVec();
        const v2 = (c as any).normalize(v1);
        const v3 = new c();
        (c as any).normalize(v1, v3);
        (v1 as any).inplaceNormalize();
        expect(v1.equalsTo(v2)).toBe(true);
        expect(v1.equalsTo(v3)).toBe(true);
        expect(numberEquals((v1 as any).magnitude, 1)).toBe(true);
      });
    }

    if (c.dot) {
      test('dot product', () => {
        const v1 = randVec();
        expect(numberEquals((c as any).dot(v1, v1), (v1 as any).magnitudeSq)).toBe(true);
      });
    }

    if (c.cross && size === 3) {
      test('cross product', () => {
        const v1 = new (c as any)(1, 0, 0);
        const v2 = new (c as any)(0, 1, 0);
        const v3 = (c as any).cross(v1, v2);
        const v4 = new (c as any)();
        (c as any).cross(v1, v2, v4);
        expect(v3.equalsTo(v4)).toBe(true);
        expect(v3.equalsTo(new (c as any)(0, 0, 1))).toBe(true);

        const v5 = (c as any).cross(v1, v1);
        expect(v5.equalsTo(new (c as any)(0, 0, 0))).toBe(true);

        const v6 = (c as any).normalize(randVec());
        const v7 = (c as any).normalize(randVec());
        const v8 = (c as any).cross(v6, v7);
        (c as any).cross(v7, v8, v6);
        const d1 = (c as any).dot(v6, v7);
        const d2 = (c as any).dot(v7, v8);
        const d3 = (c as any).dot(v8, v6);
        expect(numberEquals(d1, 0)).toBe(true);
        expect(numberEquals(d2, 0)).toBe(true);
        expect(numberEquals(d3, 0)).toBe(true);
      });
    }
  });
}

export function testQuaternion() {
  describe('Quaternion', () => {
    test('constructors (default/assign/array/matrix)', () => {
      const q1 = new Quaternion();
      expect(q1.x).toBe(0);
      expect(q1.y).toBe(0);
      expect(q1.z).toBe(0);
      expect(q1.w).toBe(1);

      const x = rand();
      const y = rand();
      const z = rand();
      const w = rand();
      const q2 = new Quaternion(x, y, z, w);
      expect(Math.abs(q2.x - x) < 0.01).toBe(true);
      expect(Math.abs(q2.y - y) < 0.01).toBe(true);
      expect(Math.abs(q2.z - z) < 0.01).toBe(true);
      expect(Math.abs(q2.w - w) < 0.01).toBe(true);

      const q3 = new Quaternion([x, y, z, w]);
      expect(q3.x).toBe(q2.x);
      expect(q3.y).toBe(q2.y);
      expect(q3.z).toBe(q2.z);
      expect(q3.w).toBe(q2.w);

      const axis = new Vector3(-0.10452544552113772, 0.43864725489574524, -0.8925598114474093);
      const angle = 3.1390559093244788;
      const axisAngle = new Quaternion(Matrix3x3.rotation(axis, angle)).getAxisAngle();
      expect(axisAngle.xyz().equalsTo(axis)).toBe(true);
      expect(numberEquals(axisAngle.w, angle)).toBe(true);

      const axisAngle2 = new Quaternion(Matrix4x4.rotation(axis, angle)).getAxisAngle();
      expect(axisAngle2.xyz().equalsTo(axis)).toBe(true);
      expect(numberEquals(axisAngle2.w, angle)).toBe(true);
    });

    test('normalize', () => {
      const q1 = new Quaternion(rand(), rand(), rand(), rand()).inplaceNormalize();
      expect(numberEquals(q1.magnitude, 1)).toBe(true);
    });

    test('unitVectorToUnitVector', () => {
      const v1 = new Vector3(rand(), rand(), rand()).inplaceNormalize();
      const v2 = new Vector3(rand(), rand(), rand()).inplaceNormalize();
      const q1 = Quaternion.unitVectorToUnitVector(v1, v2);
      const v3 = q1.transform(v1);
      expect(v2.equalsTo(v3)).toBe(true);
    });

    test('Euler angles', () => {
      const angle1 = rand(-Math.PI, Math.PI);
      const angle2 = rand(-Math.PI, Math.PI);
      const angle3 = rand(-Math.PI, Math.PI);

      const matX = Matrix3x3.rotationX(angle1);
      const matY = Matrix3x3.rotationY(angle2);
      const matZ = Matrix3x3.rotationZ(angle3);

      const testMat = new Matrix3x3();

      const rotMatrixXYZ = Matrix3x3.identity().multiplyRight(matX).multiplyRight(matY).multiplyRight(matZ);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'XYZ').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixXYZ)).toBe(true);

      const rotMatrixXZY = Matrix3x3.identity().multiplyRight(matX).multiplyRight(matZ).multiplyRight(matY);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'XZY').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixXZY)).toBe(true);

      const rotMatrixYXZ = Matrix3x3.identity().multiplyRight(matY).multiplyRight(matX).multiplyRight(matZ);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'YXZ').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixYXZ)).toBe(true);

      const rotMatrixYZX = Matrix3x3.identity().multiplyRight(matY).multiplyRight(matZ).multiplyRight(matX);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'YZX').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixYZX)).toBe(true);

      const rotMatrixZXY = Matrix3x3.identity().multiplyRight(matZ).multiplyRight(matX).multiplyRight(matY);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'ZXY').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixZXY)).toBe(true);

      const rotMatrixZYX = Matrix3x3.identity().multiplyRight(matZ).multiplyRight(matY).multiplyRight(matX);
      Quaternion.fromEulerAngle(angle1, angle2, angle3, 'ZYX').toMatrix3x3(testMat);
      expect(testMat.equalsTo(rotMatrixZYX)).toBe(true);

      const orders = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as const;
      const mats = [rotMatrixXYZ, rotMatrixYXZ, rotMatrixZXY, rotMatrixZYX, rotMatrixYZX, rotMatrixXZY];

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const mat = mats[i];
        const v = Quaternion.fromEulerAngle(angle1, angle2, angle3, order).toEulerAngles();
        Quaternion.fromEulerAngle(v.x, v.y, v.z, order).toMatrix3x3(testMat);
        // 这里原来是 console.log；对测试结果不敏感，所以可以直接保持逻辑
        if (testMat.equalsTo(mat)) {
          // 可选：console.log(`to Euler angles: ${order}`);
        }
      }
    });

    test('slerp', () => {
      const axis = new Vector3(rand(), rand(), rand()).inplaceNormalize();
      const a1 = rand(0, Math.PI / 2);
      const a2 = a1 + Math.PI / 2;
      const t = rand(0, 1);
      const a3 = a1 * (1 - t) + a2 * t;

      const q1 = Quaternion.fromAxisAngle(axis, a1);
      const q2 = Quaternion.fromAxisAngle(axis, a2);
      const q3 = Quaternion.slerp(q1, q2, t);
      const q4 = Quaternion.fromAxisAngle(axis, a3);

      const axisAngle1 = q3.getAxisAngle();
      const axisAngle2 = q4.getAxisAngle();
      expect(axisAngle1.equalsTo(axisAngle2)).toBe(true);
    });
  });
}

export function testMatrixType(c: MatrixConstructor, rows: number, cols: number) {
  const size = rows * cols;

  function randMatrix(): MatrixType {
    const m = new (c as any)();
    for (let i = 0; i < (m as any).length; i++) {
      (m as any)[i] = randNonZero();
    }
    return m;
  }

  describe(`Matrix tests for ${(c as any).name} (${rows}x${cols})`, () => {
    test('constructor & copy & from array', () => {
      const m1 = new (c as any)();
      expect((m1 as any).length).toBe(size);
      for (let i = 0; i < size; i++) {
        // 此处原代码逻辑有点问题：每个元素都和 identity 比较，不过沿用
        expect((m1 as any).equalsTo((c as any).identity())).toBe(true);
      }

      const m2 = randMatrix();
      const m3 = new (c as any)(m2);
      expect((m2 as any).equalsTo(m3)).toBe(true);

      const values = Array<number>(size);
      for (let i = 0; i < size; i++) {
        values[i] = rand();
      }
      const m4 = new (c as any)(values);
      for (let i = 0; i < size; i++) {
        expect(Math.abs((m4 as any)[i] - values[i]) < 0.01).toBe(true);
      }
    });

    test('add/sub/mul/div/scale', () => {
      const opAdd = (a: number, b: number) => a + b;
      const opSub = (a: number, b: number) => a - b;
      const opMul = (a: number, b: number) => a * b;
      const opDiv = (a: number, b: number) => a / b;

      const opList: [Function, Function, (a: number, b: number) => number, string][] = [
        [(c as any).add, (c.prototype as any).addBy, opAdd, 'add'],
        [(c as any).sub, (c.prototype as any).subBy, opSub, 'sub'],
        [(c as any).mul, (c.prototype as any).mulBy, opMul, 'mul'],
        [(c as any).div, (c.prototype as any).divBy, opDiv, 'div']
      ];

      for (const op of opList) {
        const m1 = randMatrix();
        const m2 = randMatrix();
        const m3 = new (c as any)();
        const m4 = op[0](m1, m2);
        op[0](m1, m2, m3);

        for (let i = 0; i < size; i++) {
          const t = op[2]((m1 as any)[i], (m2 as any)[i]);
          expect(Math.abs(t - (m3 as any)[i]) < 0.01 && Math.abs(t - (m4 as any)[i]) < 0.01).toBe(true);
        }

        op[1].bind(m1)(m2 as any);
        expect((m1 as any).equalsTo(m3)).toBe(true);
      }

      const factor = rand();
      const m5 = randMatrix();
      const m6 = (c as any).scale(m5, factor);
      const m7 = new (c as any)();
      (c as any).scale(m5, factor, m7);
      for (let i = 0; i < size; i++) {
        const t = (m5 as any)[i] * factor;
        expect(Math.abs((m6 as any)[i] - t) < 0.01 && Math.abs((m7 as any)[i] - t) < 0.01).toBe(true);
      }
      (m5 as any).scaleBy(factor);
      expect((m5 as any).equalsTo(m6)).toBe(true);
    });

    test('identity', () => {
      const m1 = new (c as any)();
      (m1 as any).identity();
      const m2 = (c as any).identity();
      for (let i = 0; i < size; i++) {
        const val = i % (cols + 1) === 0 ? 1 : 0;
        expect(Math.abs((m1 as any)[i] - val) < 0.01).toBe(true);
        expect(Math.abs((m2 as any)[i] - val) < 0.01).toBe(true);
      }
    });

    test('inverse', () => {
      const m1 = randMatrix();
      const m2 = (c as any).invert(m1);
      const m3 = new (c as any)();
      (c as any).invert(m1, m3);
      expect((m2 as any).equalsTo(m3)).toBe(true);

      const m4 = (c as any).multiply(m1, m2);
      expect((m4 as any).equalsTo((c as any).identity())).toBe(true);
    });

    if ((c as any).translation) {
      test('translation and translateLeft/Right', () => {
        const t = new Vector3(rand(), rand(), rand());
        const v1 = new Vector3(rand(), rand(), rand());
        const m = (c as any).translation(t);
        const v2 = m.transformPoint(v1);
        expect(numberEquals(v2.x, v1.x + t.x)).toBe(true);
        expect(numberEquals(v2.y, v1.y + t.y)).toBe(true);
        expect(numberEquals(v2.z, v1.z + t.z)).toBe(true);

        if (rows === 4 && cols === 4) {
          const m1 = randMatrix() as Matrix4x4;
          const t1 = new Vector3(rand(), rand(), rand());
          const m2 = m1.multiplyRight(Matrix4x4.translation(t1));
          m1.translateRight(t1);
          expect(m1.equalsTo(m2)).toBe(true);

          const m3 = randMatrix() as Matrix4x4;
          const t2 = new Vector3(rand(), rand(), rand());
          const m4 = m3.multiplyLeft(Matrix4x4.translation(t2));
          m3.translateLeft(t2);
          expect(m3.equalsTo(m4)).toBe(true);
        }
      });
    }

    if ((c as any).scaling) {
      test('scaling and scaleLeft/Right', () => {
        const s = new Vector3(rand(), rand(), rand());
        const v1 = new Vector3(rand(), rand(), rand());
        const m = (c as any).scaling(s);
        const v2 = m.transformPoint(v1);
        expect(numberEquals(v2.x, v1.x * s.x)).toBe(true);
        expect(numberEquals(v2.y, v1.y * s.y)).toBe(true);
        expect(numberEquals(v2.z, v1.z * s.z)).toBe(true);

        if (rows === 4 && cols === 4) {
          const m1 = randMatrix() as Matrix4x4;
          const s1 = new Vector3(rand(), rand(), rand());
          const m2 = m1.multiplyRight(Matrix4x4.scaling(s1));
          m1.scaleRight(s1);
          expect(m1.equalsTo(m2)).toBe(true);

          const m3 = randMatrix() as Matrix4x4;
          const s2 = new Vector3(rand(), rand(), rand());
          const m4 = m3.multiplyLeft(Matrix4x4.scaling(s2));
          m3.scaleLeft(s2);
          expect(m3.equalsTo(m4)).toBe(true);
        }
      });
    }

    test('rotationX / rotationY / rotationZ', () => {
      const angleX = rand(-Math.PI * 2, Math.PI * 2);
      const v1x = new Vector3(0, 1, 0);
      const mx = (c as any).rotationX(angleX);
      const vx = mx.transformPoint(v1x);
      expect(numberEquals(vx.x, 0)).toBe(true);
      expect(numberEquals(vx.y, Math.cos(angleX))).toBe(true);
      expect(numberEquals(vx.z, Math.sin(angleX))).toBe(true);

      const angleY = rand(-Math.PI * 2, Math.PI * 2);
      const v1y = new Vector3(0, 0, 1);
      const my = (c as any).rotationY(angleY);
      const vy = my.transformPoint(v1y);
      expect(numberEquals(vy.x, Math.sin(angleY))).toBe(true);
      expect(numberEquals(vy.y, 0)).toBe(true);
      expect(numberEquals(vy.z, Math.cos(angleY))).toBe(true);

      const angleZ = rand(-Math.PI * 2, Math.PI * 2);
      const v1z = new Vector3(1, 0, 0);
      const mz = (c as any).rotationZ(angleZ);
      const vz = mz.transformPoint(v1z);
      expect(numberEquals(vz.x, Math.cos(angleZ))).toBe(true);
      expect(numberEquals(vz.y, Math.sin(angleZ))).toBe(true);
      expect(numberEquals(vz.z, 0)).toBe(true);
    });

    test('rotation & rotateLeft/Right', () => {
      const angle = rand(-Math.PI * 2, Math.PI * 2);
      const v1 = new Vector3(rand(), rand(), rand());

      const vx1 = (c as any).rotation(new Vector3(1, 0, 0), angle).transformPoint(v1);
      const vx2 = (c as any).rotationX(angle).transformPoint(v1);
      expect(vx1.equalsTo(vx2)).toBe(true);

      const vy1 = (c as any).rotation(new Vector3(0, 1, 0), angle).transformPoint(v1);
      const vy2 = (c as any).rotationY(angle).transformPoint(v1);
      expect(vy1.equalsTo(vy2)).toBe(true);

      const vz1 = (c as any).rotation(new Vector3(0, 0, 1), angle).transformPoint(v1);
      const vz2 = (c as any).rotationZ(angle).transformPoint(v1);
      expect(vz1.equalsTo(vz2)).toBe(true);

      if (rows === 4 && cols === 4) {
        const m1 = randMatrix() as Matrix4x4;
        const r1 = Matrix4x4.rotation(
          new Vector3(rand(), rand(), rand()).inplaceNormalize(),
          rand(0, Math.PI * 2)
        );
        const m2 = m1.multiplyRight(r1);
        m1.rotateRight(r1);
        expect(m1.equalsTo(m2)).toBe(true);

        const m3 = randMatrix() as Matrix4x4;
        const r2 = Matrix4x4.rotation(
          new Vector3(rand(), rand(), rand()).inplaceNormalize(),
          rand(0, Math.PI * 2)
        );
        const m4 = m3.multiplyLeft(r2);
        m3.rotateLeft(r2);
        expect(m3.equalsTo(m4)).toBe(true);
      }
    });

    if (rows === 4 && cols === 4) {
      test('decompose & decomposeLookAt', () => {
        const eye = new Vector3(rand(), rand(), rand()).inplaceNormalize().scaleBy(100);
        const target = new Vector3(rand(), rand(), rand()).inplaceNormalize().scaleBy(100);
        const up = new Vector3(rand(), rand(), rand()).inplaceNormalize();
        const matrix = Matrix4x4.lookAt(eye, target, up);

        const t = new Vector3();
        const s = new Vector3();
        const r = new Matrix4x4();
        matrix.decompose(s, r, t);
        const matrix2 = Matrix4x4.translation(t)
          .multiplyRightAffine(r)
          .multiplyRightAffine(Matrix4x4.scaling(s));
        expect(matrix.equalsTo(matrix2)).toBe(true);

        const eye2 = new Vector3();
        const target2 = new Vector3();
        const up2 = new Vector3();
        matrix.decomposeLookAt(eye2, target2, up2);
        matrix2.lookAt(eye2, target2, up2);
        expect(matrix.equalsTo(matrix2)).toBe(true);
      });

      test('projection (perspective & ortho)', () => {
        const fovY = rand(0.1, 0.8 * Math.PI);
        const aspect = rand(0.1, 10);
        const near = rand(0.1, 10);
        const far = rand(100, 1000);

        const top = near * Math.tan(fovY / 2);
        const bottom = -top;
        const right = top * aspect;
        const left = -right;

        const m1 = Matrix4x4.perspective(fovY, aspect, near, far);
        const m2 = Matrix4x4.frustum(left, right, bottom, top, near, far);
        expect(m1.equalsTo(m2)).toBe(true);

        expect(m1.getLeftPlane()).toBeNear(left, 0.01);
        expect(m1.getRightPlane()).toBeNear(right, 0.01);
        expect(m1.getTopPlane()).toBeNear(top, 0.01);
        expect(m1.getBottomPlane()).toBeNear(bottom, 0.01);
        expect(m1.getNearPlane()).toBeNear(near, 0.01);
        expect(m1.getFarPlane()).toBeNear(far, 0.01);

        const vmin = new Vector4(-1, -1, -1, 1);
        const vmax = new Vector4(1, 1, 1, 1);

        const vx1 = m2.transformPoint(new Vector3(left, bottom, -near));
        vx1.scaleBy(1 / vx1.w);
        const vx2 = m2.transformPoint(new Vector3((right * far) / near, (top * far) / near, -far));
        vx2.scaleBy(1 / vx2.w);

        expect(vx1.equalsTo(vmin)).toBe(true);
        expect(vx2.equalsTo(vmax)).toBe(true);

        const leftFar = (left * far) / near;
        const rightFar = (right * far) / near;
        const bottomFar = (bottom * far) / near;
        const topFar = (top * far) / near;

        const v = [
          new Vector3(left, bottom, -near),
          new Vector3(right, bottom, -near),
          new Vector3(right, top, -near),
          new Vector3(left, top, -near),
          new Vector3(leftFar, bottomFar, -far),
          new Vector3(rightFar, bottomFar, -far),
          new Vector3(rightFar, topFar, -far),
          new Vector3(leftFar, topFar, -far)
        ];
        const v2 = [
          new Vector4(-1, -1, -1, 1),
          new Vector4(1, -1, -1, 1),
          new Vector4(1, 1, -1, 1),
          new Vector4(-1, 1, -1, 1),
          new Vector4(-1, -1, 1, 1),
          new Vector4(1, -1, 1, 1),
          new Vector4(1, 1, 1, 1),
          new Vector4(-1, 1, 1, 1)
        ];
        for (let i = 0; i < 8; i++) {
          const t = m1.transformPoint(v[i]);
          t.scaleBy(1 / t.w);
          expect(v2[i].equalsTo(t)).toBe(true);
        }

        const m3 = Matrix4x4.ortho(left, right, bottom, top, near, far);
        expect(numberEquals(m3.getLeftPlane(), left, 0.01)).toBe(true);
        expect(numberEquals(m3.getRightPlane(), right, 0.01)).toBe(true);
        expect(numberEquals(m3.getTopPlane(), top, 0.01)).toBe(true);
        expect(numberEquals(m3.getBottomPlane(), bottom, 0.01)).toBe(true);
        expect(numberEquals(m3.getNearPlane(), near, 0.01)).toBe(true);
        expect(numberEquals(m3.getFarPlane(), far, 0.01)).toBe(true);

        const v3 = [
          new Vector3(left, bottom, -near),
          new Vector3(right, bottom, -near),
          new Vector3(right, top, -near),
          new Vector3(left, top, -near),
          new Vector3(left, bottom, -far),
          new Vector3(right, bottom, -far),
          new Vector3(right, top, -far),
          new Vector3(left, top, -far)
        ];
        const v4 = [
          new Vector4(-1, -1, -1, 1),
          new Vector4(1, -1, -1, 1),
          new Vector4(1, 1, -1, 1),
          new Vector4(-1, 1, -1, 1),
          new Vector4(-1, -1, 1, 1),
          new Vector4(1, -1, 1, 1),
          new Vector4(1, 1, 1, 1),
          new Vector4(-1, 1, 1, 1)
        ];
        for (let i = 0; i < 8; i++) {
          const t = m3.transformPoint(v3[i]);
          t.scaleBy(1 / t.w);
          expect(v4[i].equalsTo(t)).toBe(true);
        }
      });
    }
  });
}

export function testXForm() {
  describe('SceneNode world matrix vs manual multiply', () => {
    function multiplyMatrices(matrices: Matrix4x4[], out: Matrix4x4[], outInv: Matrix4x4[]) {
      out[0] = new Matrix4x4(matrices[0]);
      outInv[0] = Matrix4x4.invertAffine(out[0]);
      for (let i = 1; i < matrices.length; i++) {
        out[i] = Matrix4x4.multiply(out[i - 1], matrices[i]);
        outInv[i] = Matrix4x4.invertAffine(out[i]);
      }
    }

    function combinedMatrices(matrices: Matrix4x4[], matricesInv: Matrix4x4[], start: number, end: number) {
      if (start === 0) {
        return matrices[end];
      } else {
        return Matrix4x4.multiplyAffine(matricesInv[start - 1], matrices[end]);
      }
    }

    function randomIndices(minIndex: number, maxIndex: number, size: number) {
      const arr = Array<number>(size);
      for (let i = 0; i < size; i++) {
        arr[i] = randInt(minIndex, maxIndex);
      }
      return arr;
    }

    test('worldMatrix equals chained local matrices', () => {
      const count = 10;
      const scene = new Scene();
      const xformArray = Array<SceneNode>(count);
      const matrixArray = Array<Matrix4x4>(count);
      const mulArray = Array<Matrix4x4>(count);
      const invArray = Array<Matrix4x4>(count);

      for (let i = 0; i < count; i++) {
        xformArray[i] = new SceneNode(scene).reparent(xformArray[i - 1]);
        (xformArray[i] as any).__index__ = i;
        matrixArray[i] = Matrix4x4.identity();
      }

      const indices = randomIndices(0, count - 1, 50);
      indices[0] = 0;

      for (const index of indices) {
        const t = new Vector3(rand(-1000, 1000), rand(-1000, 1000), rand(-1000, 1000));
        const r = new Quaternion(rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(-1, 1)).inplaceNormalize();
        const s = new Vector3(rand(1, 10), rand(1, 10), rand(1, 10));

        if (index === 0) {
          matrixArray[index].set(Matrix4x4.translation(t).rotateRight(r));
          xformArray[index].position.set(t);
          xformArray[index].rotation.set(r);
        } else {
          matrixArray[index].set(Matrix4x4.translation(t).rotateRight(r).scaleRight(s));
          xformArray[index].position.set(t);
          xformArray[index].rotation.set(r);
          xformArray[index].scale.set(s);
        }

        if (index % 5 === 0) {
          multiplyMatrices(matrixArray, mulArray, invArray);
          const indices2 = randomIndices(1, count - 1, 50);
          for (const i of indices2) {
            const xformMatrixWorld = xformArray[i].worldMatrix;
            const bfMatrixWorld = combinedMatrices(mulArray, invArray, 0, i);
            expect(xformMatrixWorld.equalsTo(bfMatrixWorld)).toBe(true);
          }
        }
      }
    });
  });
}
