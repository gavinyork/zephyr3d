import { Vector2, Vector3, Vector4, Matrix3x3, Matrix4x4 } from '@zephyr3d/base';
import type { TestCase } from '../common';
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
  }
];

function traceRayThroughGrid(x0, y0, dx, dy, gridSizeX, gridSizeY, x, y, w, h, callback) {
  const epsl = 0.001;
  let tx = 0;
  let ty = 0;
  const xmin = x * gridSizeX;
  const xmax = xmin + w * gridSizeX;
  const ymin = y * gridSizeY;
  const ymax = ymin + h * gridSizeY;
  const xcenter = (xmin + xmax) / 2;
  const ycenter = (ymin + ymax) / 2;
  let mirrorx = false;
  let mirrory = false;
  if (dx < 0) {
    dx = -dx;
    x0 += 2 * (xcenter - x0);
    mirrorx = true;
  }
  if (dy < 0) {
    dy = -dy;
    y0 += 2 * (ycenter - y0);
    mirrory = true;
  }
  if (x0 < xmin) {
    tx = (xmin - x0) / dx;
  } else if (x0 > xmax) {
    return;
  }
  if (y0 < ymin) {
    ty = (ymin - y0) / dy;
  } else if (y0 > ymax) {
    return;
  }
  const t = tx > ty ? tx : ty;
  x0 += t * dx;
  y0 += t * dy;
  let u = Math.floor((x0 - xmin + epsl) / gridSizeX);
  let v = Math.floor((y0 - ymin + epsl) / gridSizeY);
  while (u >= x && u <= x + w && v >= y && v <= y + h) {
    if (u < x + w && v < y + h) {
      const m = mirrorx ? w - (u - x) - 1 + x : u;
      const n = mirrory ? h - (v - y) - 1 + y : v;
      callback(m, n);
    }
    let d = Infinity;
    if (dx > 0) {
      const x1 = (u + 1) * gridSizeX;
      d = Math.min(d, (x1 - x0) / dx);
    }
    if (dy !== 0) {
      const y1 = (v + 1) * gridSizeY;
      d = Math.min(d, (y1 - y0) / dy);
    }
    x0 += d * dx;
    y0 += d * dy;
    u = Math.floor((x0 - xmin + epsl) / gridSizeX);
    v = Math.floor((y0 - ymin + epsl) / gridSizeY);
  }
}

(async function () {
  traceRayThroughGrid(4.2, 3.8, 1, -1.1, 1, 1, 0, 0, 10, 10, console.log);
  await doTest('math test', testCases);
})();
