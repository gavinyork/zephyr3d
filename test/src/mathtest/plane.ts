import { Plane, Vector3 } from '@zephyr3d/base';
import { rand, numberEquals } from './common';

describe('Plane', () => {
  test('distanceToPoint and nearestPointToPoint and inplaceFlip', () => {
    const x = rand(-1000, 1000);
    const y = rand(1, 100);
    const z = rand(-1000, 1000);

    const plane = new Plane(new Vector3(x, y, z), new Vector3(0, 1, 0));

    const x1 = rand(-1000, 1000);
    const y1 = rand(y + rand(0, 100));
    const z1 = rand(-1000, 1000);
    const p1 = new Vector3(x1, y1, z1);

    // 原始平面
    expect(numberEquals(plane.distanceToPoint(p1), y1 - y)).toBe(true);
    expect(plane.nearestPointToPoint(p1).equalsTo(new Vector3(x1, y, z1))).toBe(true);

    // 翻转法线后
    plane.inplaceFlip();

    expect(numberEquals(plane.distanceToPoint(p1), y - y1)).toBe(true);
    expect(plane.nearestPointToPoint(p1).equalsTo(new Vector3(x1, y, z1))).toBe(true);
  });
});
