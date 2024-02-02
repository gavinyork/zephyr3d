import { Vector2, Vector3, Vector4, Matrix3x3, Matrix4x4, ObservableVector2, Quaternion, Plane } from '@zephyr3d/base';
import { TestCase, doTest } from '../common';
import { testVectorType, testMatrixType, testQuaternion, testXForm } from './vector';
import { testPlane } from './plane';
import { testFrustum } from './frustum';
import { testAABB } from './aabb';
import { testSH } from './sh';
import { packFloat3 } from '@zephyr3d/base';

const testCases: TestCase[] = [
  {
    caseName: 'Vector2 test',
    times: 100,
    execute: () => testVectorType(Vector2, 2)
  },
  {
    caseName: 'Vector3 test',
    times: 100,
    execute: () => testVectorType(Vector3, 3)
  },
  {
    caseName: 'Vector4 test',
    times: 100,
    execute: () => testVectorType(Vector4, 4)
  },
  {
    caseName: 'Quaternion test',
    times: 100,
    execute: () => testQuaternion()
  },
  {
    caseName: 'Matrix3x3 test',
    times: 100,
    execute: () => testMatrixType(Matrix3x3, 3, 3)
  },
  {
    caseName: 'Matrix4x4 test',
    times: 100,
    execute: () => testMatrixType(Matrix4x4, 4, 4)
  },
  {
    caseName: 'XForm test',
    times: 100,
    execute: () => testXForm()
  },
  {
    caseName: 'Plane test',
    times: 100,
    execute: () => testPlane()
  },
  {
    caseName: 'Frustum test',
    times: 100,
    execute: () => testFrustum()
  },
  {
    caseName: 'AABB test',
    times: 100,
    execute: () => testAABB()
  },
  /*
  {
    caseName: 'SH test',
    times: 1,
    execute: () => testSH()
  }
  */
];
const p = Matrix4x4.perspective(Math.PI/2, 1, 1, 200);
for (let i = 0; i < 100; i++) {
  const x = new Vector4(0, 0, -1 - i, 1);
  const z = p.transform(x);
  console.log(`(${x.z}, ${(z.z/z.w)*0.5 + 0.5})`);
}

for (let i = 0; i < 10; i++) {
  const mat = new Matrix4x4();
  mat.rotateLeft(new Matrix4x4(Quaternion.fromEulerAngle(0, Math.PI * 2 * i / 10, 0, 'ZYX'))).translateLeft(new Vector3(0, 5 * i / 10, 0));
  console.log(`${mat[12]}, ${mat[13]}, ${mat[14]}`);
}

const plane = new Plane(0, -1, 0, 0);
const clipPlane = new Plane(0, -1, 0, 0);
const matReflectionR = Matrix4x4.invert(Matrix4x4.reflection(-plane.a, -plane.b, -plane.c, -plane.d));
const m = matReflectionR;
const m2 = Matrix4x4.lookAt(new Vector3(1,1,1), new Vector3(0,0,0), new Vector3(0,1,0));
console.log(m.det());
console.log(m2.det());
(async function () {
  await doTest('math test', testCases);
})();
