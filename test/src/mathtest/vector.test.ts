import { Vector2, Vector3, Vector4, Matrix3x3, Matrix4x4 } from '@zephyr3d/base';
import { testVectorType, testMatrixType, testQuaternion, testXForm } from './vector';

for (let i = 0; i < 200; i++) {
  // Vector tests
  testVectorType(Vector2 as any, 2);
  testVectorType(Vector3 as any, 3);
  testVectorType(Vector4 as any, 4);

  // Quaternion tests
  testQuaternion();

  // Matrix tests
  testMatrixType(Matrix3x3 as any, 3, 3);
  testMatrixType(Matrix4x4 as any, 4, 4);

  // XForm / SceneNode tests
  testXForm();
}
