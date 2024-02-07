import { Vector2, Vector3, Vector4, Matrix3x3, Matrix4x4 } from '@zephyr3d/base';
import type { TestCase} from '../common';
import { doTest } from '../common';
import { testVectorType, testMatrixType, testQuaternion, testXForm } from './vector';
import { testPlane } from './plane';
import { testFrustum } from './frustum';
import { testAABB } from './aabb';

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
];

(async function () {
  await doTest('math test', testCases);
})();
