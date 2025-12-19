import { Vector3, Quaternion, Matrix4x4, Frustum, BoxSide } from '@zephyr3d/base';
import { rand, numberEquals } from './common';

describe('Frustum', () => {
  test('orthographic frustum planes and world-space transform', () => {
    const left = rand(-1000, 1000);
    const bottom = -rand(-1000, 1000);
    const near = rand(-100, 100);
    const right = left + rand(1, 500);
    const top = bottom + rand(1, 500);
    const far = near + rand(1, 1000);

    const matrix = Matrix4x4.ortho(left, right, bottom, top, near, far);
    const frustum = new Frustum(matrix);

    // left
    expect(frustum.planes[BoxSide.LEFT].getNormal().equalsTo(new Vector3(1, 0, 0))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.LEFT].d, -left)).toBe(true);

    // right
    expect(frustum.planes[BoxSide.RIGHT].getNormal().equalsTo(new Vector3(-1, 0, 0))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.RIGHT].d, right)).toBe(true);

    // bottom
    expect(frustum.planes[BoxSide.BOTTOM].getNormal().equalsTo(new Vector3(0, 1, 0))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.BOTTOM].d, -bottom)).toBe(true);

    // top
    expect(frustum.planes[BoxSide.TOP].getNormal().equalsTo(new Vector3(0, -1, 0))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.TOP].d, top)).toBe(true);

    // front (near)
    expect(frustum.planes[BoxSide.FRONT].getNormal().equalsTo(new Vector3(0, 0, -1))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.FRONT].d, -near)).toBe(true);

    // back (far)
    expect(frustum.planes[BoxSide.BACK].getNormal().equalsTo(new Vector3(0, 0, 1))).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.BACK].d, far)).toBe(true);

    // world-space transform: corners transform 应与用变换后的 frustum 对应
    const axis = new Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)).inplaceNormalize();
    const angle = rand(-Math.PI, Math.PI);
    const q = Quaternion.fromAxisAngle(axis, angle);
    const t = new Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10));
    const mat = q.toMatrix4x4().translateLeft(t);
    const frustum2 = new Frustum(Matrix4x4.multiply(matrix, Matrix4x4.invertAffine(mat)));

    for (let i = 0; i < 8; i++) {
      expect(mat.transformPoint(frustum.corners[i]).xyz().equalsTo(frustum2.corners[i])).toBe(true);
    }
  });

  test('perspective frustum planes, setNearFar and point classification', () => {
    const halfFovY = rand(0.1, Math.PI * 0.5);
    const near = rand(1, 10);
    const far = rand(11, 100);
    const aspect = rand(0.5, 10);

    const matrix = Matrix4x4.perspective(2 * halfFovY, aspect, near, far);

    // setNearFar correctness
    const near2 = 30;
    const far2 = 80;
    const matrix1 = new Matrix4x4(matrix);
    matrix1.setNearFar(near2, far2);
    const matrix2 = Matrix4x4.perspective(2 * halfFovY, aspect, near2, far2);
    expect(matrix1.equalsTo(matrix2, 0.001)).toBe(true);

    const nz = new Vector3(0, 0, -1);
    const frustum = new Frustum(matrix);

    const normalTop = Matrix4x4.rotationX(halfFovY - Math.PI * 0.5)
      .transformVector(nz)
      .xyz();
    const normalBottom = Matrix4x4.rotationX(Math.PI * 0.5 - halfFovY)
      .transformVector(nz)
      .xyz();

    const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
    const normalLeft = Matrix4x4.rotationY(halfFovX - Math.PI * 0.5)
      .transformVector(nz)
      .xyz();
    const normalRight = Matrix4x4.rotationY(Math.PI * 0.5 - halfFovX)
      .transformVector(nz)
      .xyz();

    const normalNear = nz;
    const normalFar = Vector3.scale(nz, -1);

    // left
    expect(frustum.planes[BoxSide.LEFT].getNormal().equalsTo(normalLeft)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.LEFT].d, 0)).toBe(true);

    // right
    expect(frustum.planes[BoxSide.RIGHT].getNormal().equalsTo(normalRight)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.RIGHT].d, 0)).toBe(true);

    // bottom
    expect(frustum.planes[BoxSide.BOTTOM].getNormal().equalsTo(normalBottom)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.BOTTOM].d, 0)).toBe(true);

    // top
    expect(frustum.planes[BoxSide.TOP].getNormal().equalsTo(normalTop)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.TOP].d, 0)).toBe(true);

    // front (near)
    expect(frustum.planes[BoxSide.FRONT].getNormal().equalsTo(normalNear)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.FRONT].d, -near)).toBe(true);

    // back (far)
    expect(frustum.planes[BoxSide.BACK].getNormal().equalsTo(normalFar)).toBe(true);
    expect(numberEquals(frustum.planes[BoxSide.BACK].d, far)).toBe(true);

    // point classification
    const halfW = far * Math.tan(halfFovX);
    const halfH = far * Math.tan(halfFovY);
    const x = rand(-halfW, halfW);
    const y = rand(-halfH, halfH);
    const z = rand(near + 200, far - 200);

    const aw = Math.atan(x / z);
    const ah = Math.atan(y / z);
    const inside1 =
      z <= -near && z >= -far && aw >= -halfFovX && aw <= halfFovX && ah >= -halfFovY && ah <= halfFovY;

    const inside2 = frustum.containsPoint(new Vector3(x, y, z));

    expect(Boolean(inside1)).toBe(Boolean(inside2));
  });
});
