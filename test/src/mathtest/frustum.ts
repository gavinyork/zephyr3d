import { Vector3, Quaternion, Matrix4x4, Frustum, BoxSide } from '@zephyr3d/base';
import { assert, rand, numberEquals } from './common';

export function testFrustum() {
  (function testOrthoFrustum() {
    const left = rand(-1000, 1000);
    const bottom = -rand(-1000, 1000);
    const near = rand(-100, 100);
    const right = left + rand(1, 500);
    const top = bottom + rand(1, 500);
    const far = near + rand(1, 1000);
    const matrix = Matrix4x4.ortho(left, right, bottom, top, near, far);
    const frustum = new Frustum(matrix);
    assert(
      frustum.planes[BoxSide.LEFT].getNormal().equalsTo(new Vector3(1, 0, 0)),
      'ortho left plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.LEFT].d, -left), 'ortho left plane test failed');
    assert(
      frustum.planes[BoxSide.RIGHT].getNormal().equalsTo(new Vector3(-1, 0, 0)),
      'ortho right plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.RIGHT].d, right), 'ortho right plane test failed');
    assert(
      frustum.planes[BoxSide.BOTTOM].getNormal().equalsTo(new Vector3(0, 1, 0)),
      'ortho bottom plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.BOTTOM].d, -bottom), 'ortho bottom plane test failed');
    assert(
      frustum.planes[BoxSide.TOP].getNormal().equalsTo(new Vector3(0, -1, 0)),
      'ortho top plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.TOP].d, top), 'ortho top plane test failed');
    assert(
      frustum.planes[BoxSide.FRONT].getNormal().equalsTo(new Vector3(0, 0, -1)),
      'ortho front plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.FRONT].d, -near), 'ortho front plane test failed');
    assert(
      frustum.planes[BoxSide.BACK].getNormal().equalsTo(new Vector3(0, 0, 1)),
      'ortho back plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.BACK].d, far), 'ortho back plane test failed');
    const axis = new Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)).inplaceNormalize();
    const angle = rand(-Math.PI, Math.PI);
    const q = Quaternion.fromAxisAngle(axis, angle);
    const t = new Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10));
    const mat = q.toMatrix4x4().translateLeft(t);
    const frustum2 = new Frustum(Matrix4x4.multiply(matrix, Matrix4x4.invertAffine(mat)));
    for (let i = 0; i < 8; i++) {
      assert(
        mat.transformPoint(frustum.corners[i]).xyz().equalsTo(frustum2.corners[i]),
        'world space frustum test failed'
      );
    }
  })();
  (function testPerspectiveFrustum() {
    const halfFovY = rand(0.1, Math.PI * 0.5);
    const near = rand(1, 10);
    const far = rand(11, 100);
    const aspect = rand(0.5, 10);
    const matrix = Matrix4x4.perspective(2 * halfFovY, aspect, near, far);
    const near2 = 30;
    const far2 = 80;
    const matrix1 = new Matrix4x4(matrix);
    matrix1.setNearFar(near2, far2);
    const matrix2 = Matrix4x4.perspective(2 * halfFovY, aspect, near2, far2);
    assert(matrix1.equalsTo(matrix2, 0.001), 'setNearFar() test failed');

    /*
    const eyeSpaceVector = new Vector3(0, 0, -rand(near + 0.5, far - 0.5));
    const clipSpaceVector = matrix.transformPoint(eyeSpaceVector);
    const clipSpaceZ_GL = clipSpaceVector.z / clipSpaceVector.w;
    const clipSpaceZ_D3D = (clipSpaceVector.z + clipSpaceVector.w) / (2 * clipSpaceVector.w);
    const linearizedZ_GL = (2 * near * far) / (far + near - clipSpaceZ_GL * (far - near));
    const linearizedZ_D3D = (2 * near * far) / (far + near - (clipSpaceZ_D3D * 2 - 1) * (far - near));
    console.log(eyeSpaceVector.z, linearizedZ_GL, linearizedZ_D3D);
    */
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
    assert(
      frustum.planes[BoxSide.LEFT].getNormal().equalsTo(normalLeft),
      'perspective left plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.LEFT].d, 0), 'perspective left plane test failed');
    assert(
      frustum.planes[BoxSide.RIGHT].getNormal().equalsTo(normalRight),
      'perspective right plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.RIGHT].d, 0), 'perspective right plane test failed');
    assert(
      frustum.planes[BoxSide.BOTTOM].getNormal().equalsTo(normalBottom),
      'perspective bottom plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.BOTTOM].d, 0), 'perspective bottom plane test failed');
    assert(frustum.planes[BoxSide.TOP].getNormal().equalsTo(normalTop), 'perspective top plane test failed');
    assert(numberEquals(frustum.planes[BoxSide.TOP].d, 0), 'perspective top plane test failed');
    assert(
      frustum.planes[BoxSide.FRONT].getNormal().equalsTo(normalNear),
      'perspective front plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.FRONT].d, -near), 'perspective front plane test failed');
    assert(
      frustum.planes[BoxSide.BACK].getNormal().equalsTo(normalFar),
      'perspective back plane test failed'
    );
    assert(numberEquals(frustum.planes[BoxSide.BACK].d, far), 'perspective back plane test failed');
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
    assert(!!inside1 === !!inside2, 'point classification failed');
  })();
}
