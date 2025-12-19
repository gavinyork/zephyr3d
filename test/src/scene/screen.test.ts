import type { ScreenConfig } from '@zephyr3d/scene';
import { ScreenAdapter } from '@zephyr3d/scene';
import { Vector2 } from '@zephyr3d/base';

// Mock getDevice
jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    getDrawingBufferWidth: () => 1920,
    getDrawingBufferHeight: () => 1080,
    deviceXToScreen: (x: number) => x,
    deviceYToScreen: (y: number) => y
  }))
}));

describe('ScreenAdapter', () => {
  describe('构造函数和配置', () => {
    test('应该使用默认配置创建实例', () => {
      const adapter = new ScreenAdapter();
      expect(adapter.config.designWidth).toBe(1920);
      expect(adapter.config.designHeight).toBe(1080);
      expect(adapter.config.scaleMode).toBe('cover');
    });

    test('应该使用自定义配置创建实例', () => {
      const config: ScreenConfig = {
        designWidth: 1280,
        designHeight: 720,
        scaleMode: 'fit'
      };
      const adapter = new ScreenAdapter(config);
      expect(adapter.config.designWidth).toBe(1280);
      expect(adapter.config.designHeight).toBe(720);
      expect(adapter.config.scaleMode).toBe('fit');
    });

    test('应该能重新配置', () => {
      const adapter = new ScreenAdapter();
      adapter.configure({
        designWidth: 800,
        designHeight: 600,
        scaleMode: 'stretch'
      });
      expect(adapter.config.designWidth).toBe(800);
      expect(adapter.config.designHeight).toBe(600);
      expect(adapter.config.scaleMode).toBe('stretch');
    });

    test('应该合并部分配置与默认值', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1024,
        designHeight: 768,
        scaleMode: 'fit-width'
      } as ScreenConfig);
      expect(adapter.config.designWidth).toBe(1024);
      expect(adapter.config.designHeight).toBe(768);
      expect(adapter.config.scaleMode).toBe('fit-width');
    });
  });

  describe('viewport 属性', () => {
    test('初始 viewport 应该为 null', () => {
      const adapter = new ScreenAdapter();
      expect(adapter.viewport).toBeNull();
    });

    test('应该能设置和获取 viewport', () => {
      const adapter = new ScreenAdapter();
      adapter.viewport = [0, 0, 800, 600];
      expect(adapter.viewport).toEqual([0, 0, 800, 600]);
    });

    test('设置 viewport 应该触发 transform 重新计算', () => {
      const adapter = new ScreenAdapter();
      const transform1 = adapter.transform;
      adapter.viewport = [0, 0, 1024, 768];
      const transform2 = adapter.transform;
      expect(transform1).not.toBe(transform2);
    });

    test('设置相同的 viewport 应该创建新副本', () => {
      const adapter = new ScreenAdapter();
      const vp = [0, 0, 800, 600];
      adapter.viewport = vp;
      expect(adapter.viewport).not.toBe(vp);
      expect(adapter.viewport).toEqual(vp);
    });
  });

  describe('calculateResolutionTransform - fit 模式', () => {
    test('宽度受限时应该添加上下黑边', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      // 视口更宽更矮（16:9 -> 21:9）
      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1080);

      // 应该匹配高度，宽度居中
      expect(transform.viewportWidth).toBeCloseTo(1920);
      expect(transform.viewportHeight).toBeCloseTo(1080);
      expect(transform.viewportX).toBeCloseTo(320); // (2560 - 1920) / 2
      expect(transform.viewportY).toBeCloseTo(0);
    });

    test('高度受限时应该添加左右黑边', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      // 视口更窄更高（16:9 -> 4:3）
      const transform = adapter.calculateResolutionTransform(0, 0, 1440, 1080);

      // 应该匹配宽度，高度居中
      expect(transform.viewportWidth).toBeCloseTo(1440);
      expect(transform.viewportHeight).toBeCloseTo(810);
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(135); // (1080 - 810) / 2
    });

    test('完美匹配时不应该有黑边', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 1920, 1080);

      expect(transform.viewportWidth).toBeCloseTo(1920);
      expect(transform.viewportHeight).toBeCloseTo(1080);
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(0);
    });
  });

  describe('calculateResolutionTransform - cover 模式', () => {
    test('应该填满整个视口，可能裁剪设计区域', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'cover'
      });

      // 更宽的视口
      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1080);

      // 应该填满视口，设计区域被拉伸
      expect(transform.viewportWidth).toBeCloseTo(2560);
      expect(transform.viewportHeight).toBeCloseTo(1440);
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(-180); // (1080 - 1440) / 2
    });

    test('应该计算正确的裁剪区域', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'cover'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1080);

      expect(transform.croppedViewport.x).toBeCloseTo(0);
      expect(transform.croppedViewport.y).toBeCloseTo(0);
      expect(transform.croppedViewport.width).toBeCloseTo(2560);
      expect(transform.croppedViewport.height).toBeCloseTo(1080);
    });
  });

  describe('calculateResolutionTransform - stretch 模式', () => {
    test('应该拉伸填充整个视口，不保持宽高比', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'stretch'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 800, 1200);

      expect(transform.viewportWidth).toBe(800);
      expect(transform.viewportHeight).toBe(1200);
      expect(transform.viewportX).toBe(0);
      expect(transform.viewportY).toBe(0);

      // 非等比缩放
      expect(transform.canvasToLogic.scaleX).toBeCloseTo(1920 / 800);
      expect(transform.canvasToLogic.scaleY).toBeCloseTo(1080 / 1200);
    });
  });

  describe('calculateResolutionTransform - fit-width 模式', () => {
    test('应该精确匹配宽度，高度跟随宽高比', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit-width'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 1280, 720);

      expect(transform.viewportWidth).toBeCloseTo(1280);
      expect(transform.viewportHeight).toBeCloseTo(720); // 1080 * (1280/1920)
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(0);
    });

    test('高度超出时应该居中', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit-width'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 960, 540);

      expect(transform.viewportWidth).toBeCloseTo(960);
      expect(transform.viewportHeight).toBeCloseTo(540); // 1080 * (960/1920)
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(0);
    });
  });

  describe('calculateResolutionTransform - fit-height 模式', () => {
    test('应该精确匹配高度，宽度跟随宽高比', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit-height'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 1280, 720);

      expect(transform.viewportWidth).toBeCloseTo(1280); // 1920 * (720/1080)
      expect(transform.viewportHeight).toBeCloseTo(720);
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(0);
    });

    test('宽度超出时应该居中', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit-height'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1440);

      expect(transform.viewportWidth).toBeCloseTo(2560); // 1920 * (1440/1080)
      expect(transform.viewportHeight).toBeCloseTo(1440);
      expect(transform.viewportX).toBeCloseTo(0);
      expect(transform.viewportY).toBeCloseTo(0);
    });
  });

  describe('calculateResolutionTransform - 边界情况', () => {
    test('零尺寸视口应该返回零尺寸 transform', () => {
      const adapter = new ScreenAdapter();
      const transform = adapter.calculateResolutionTransform(0, 0, 0, 0);

      expect(transform.viewportWidth).toBe(0);
      expect(transform.viewportHeight).toBe(0);
      expect(transform.croppedViewport.width).toBe(0);
      expect(transform.croppedViewport.height).toBe(0);
    });

    test('负尺寸视口应该返回零尺寸 transform', () => {
      const adapter = new ScreenAdapter();
      const transform = adapter.calculateResolutionTransform(0, 0, -100, -100);

      expect(transform.viewportWidth).toBe(0);
      expect(transform.viewportHeight).toBe(0);
    });

    test('非零偏移的视口应该正确处理', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      const transform = adapter.calculateResolutionTransform(100, 50, 1920, 1080);

      expect(transform.viewportX).toBeCloseTo(100);
      expect(transform.viewportY).toBeCloseTo(50);
    });
  });

  describe('坐标转换 - canvasToViewport', () => {
    test('应该将 canvas 坐标转换为 viewport 本地坐标', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });
      adapter.viewport = [0, 0, 1920, 1080];

      const canvasPos = new Vector2(960, 540);
      const viewportPos = adapter.canvasPosToViewport(canvasPos);

      expect(viewportPos.x).toBeCloseTo(960);
      expect(viewportPos.y).toBeCloseTo(540);
    });

    test('应该处理有偏移的视口', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });
      adapter.viewport = [100, 50, 1920, 1080];

      const canvasPos = new Vector2(100, 50); // viewport 左上角
      const viewportPos = adapter.canvasPosToViewport(canvasPos);

      expect(viewportPos.x).toBeCloseTo(0);
      expect(viewportPos.y).toBeCloseTo(0);
    });

    test('应该能使用输出参数', () => {
      const adapter = new ScreenAdapter();
      adapter.viewport = [0, 0, 1920, 1080];

      const canvasPos = new Vector2(100, 200);
      const output = new Vector2();
      const result = adapter.canvasPosToViewport(canvasPos, output);

      expect(result).toBe(output);
      expect(output.x).toBeCloseTo(100);
      expect(output.y).toBeCloseTo(200);
    });
  });

  describe('坐标转换 - canvasToLogic', () => {
    test('应该将 canvas 坐标转换为逻辑设计坐标', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'stretch'
      });
      adapter.viewport = [0, 0, 960, 540]; // 缩放 0.5x

      const canvasPos = new Vector2(480, 270); // canvas 中心
      const logicPos = adapter.canvasPosToLogic(canvasPos);

      expect(logicPos.x).toBeCloseTo(960); // 设计分辨率中心
      expect(logicPos.y).toBeCloseTo(540);
    });

    test('fit 模式下应该正确转换', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });
      adapter.viewport = [0, 0, 2560, 1080]; // 宽度受限，会有黑边

      const transform = adapter.transform;
      const canvasPos = new Vector2(
        transform.viewportX + transform.viewportWidth / 2,
        transform.viewportY + transform.viewportHeight / 2
      );
      const logicPos = adapter.canvasPosToLogic(canvasPos);

      expect(logicPos.x).toBeCloseTo(960); // 设计分辨率中心
      expect(logicPos.y).toBeCloseTo(540);
    });

    test('应该能使用输出参数', () => {
      const adapter = new ScreenAdapter();
      adapter.viewport = [0, 0, 1920, 1080];

      const canvasPos = new Vector2(960, 540);
      const output = new Vector2();
      const result = adapter.canvasPosToLogic(canvasPos, output);

      expect(result).toBe(output);
    });
  });

  describe('坐标转换 - transformPoint', () => {
    test('应该应用仿射变换', () => {
      const adapter = new ScreenAdapter();
      const transform = {
        scaleX: 2,
        scaleY: 3,
        offsetX: 10,
        offsetY: 20
      };

      const input = new Vector2(5, 10);
      const output = adapter.transformPoint(transform, input);

      // outX = 5 * 2 + 10 = 20
      // outY = 10 * 3 + 20 = 50
      expect(output.x).toBeCloseTo(20);
      expect(output.y).toBeCloseTo(50);
    });

    test('应该能使用输出参数', () => {
      const adapter = new ScreenAdapter();
      const transform = {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0
      };

      const input = new Vector2(10, 20);
      const output = new Vector2();
      const result = adapter.transformPoint(transform, input, output);

      expect(result).toBe(output);
      expect(output.x).toBe(10);
      expect(output.y).toBe(20);
    });
  });

  describe('transform 属性缓存', () => {
    test('应该缓存 transform 结果', () => {
      const adapter = new ScreenAdapter();
      adapter.viewport = [0, 0, 1920, 1080];

      const transform1 = adapter.transform;
      const transform2 = adapter.transform;

      expect(transform1).toBe(transform2);
    });

    test('改变 viewport 应该使缓存失效', () => {
      const adapter = new ScreenAdapter();
      adapter.viewport = [0, 0, 1920, 1080];

      const transform1 = adapter.transform;
      adapter.viewport = [0, 0, 1280, 720];
      const transform2 = adapter.transform;

      expect(transform1).not.toBe(transform2);
    });

    test('未设置 viewport 时应该使用设备默认值', () => {
      const adapter = new ScreenAdapter();
      const transform = adapter.transform;

      expect(transform).toBeDefined();
      expect(transform.viewportWidth).toBe(1920);
      expect(transform.viewportHeight).toBe(1080);
    });
  });

  describe('裁剪视口计算', () => {
    test('完全可见的视口', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 1920, 1080);

      expect(transform.croppedViewport.x).toBeCloseTo(0);
      expect(transform.croppedViewport.y).toBeCloseTo(0);
      expect(transform.croppedViewport.width).toBeCloseTo(1920);
      expect(transform.croppedViewport.height).toBeCloseTo(1080);
    });

    test('cover 模式下的垂直裁剪', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'cover'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1080);

      // 调整后的视口超出了原始视口的上下边界
      expect(transform.viewportHeight).toBeGreaterThan(1080);

      // 但裁剪后的可见区域应该正好是原始视口
      expect(transform.croppedViewport.x).toBeCloseTo(0);
      expect(transform.croppedViewport.y).toBeCloseTo(0);
      expect(transform.croppedViewport.width).toBeCloseTo(2560);
      expect(transform.croppedViewport.height).toBeCloseTo(1080);
    });

    test('cover 模式下的水平裁剪', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'cover'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 1440, 1440);

      // 调整后的视口超出了原始视口的左右边界
      expect(transform.viewportWidth).toBeGreaterThan(1440);

      // 裁剪后的可见区域
      expect(transform.croppedViewport.width).toBeCloseTo(1440);
      expect(transform.croppedViewport.height).toBeCloseTo(1440);
    });

    test('零尺寸视口导致零裁剪', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 0, 0);

      expect(transform.croppedViewport.width).toBe(0);
      expect(transform.croppedViewport.height).toBe(0);
    });
  });

  describe('实际应用场景', () => {
    test('移动端竖屏适配', () => {
      const adapter = new ScreenAdapter({
        designWidth: 750, // 移动端常用设计宽度
        designHeight: 1334,
        scaleMode: 'fit-width'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 375, 812); // iPhone X

      expect(transform.viewportWidth).toBeCloseTo(375);
      // 高度应该按比例缩放
      const expectedHeight = 1334 * (375 / 750);
      expect(transform.viewportHeight).toBeCloseTo(expectedHeight);
    });

    test('PC 端宽屏适配', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'cover'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 3840, 1080); // 超宽屏

      // 应该填满整个宽度
      expect(transform.viewportWidth).toBeCloseTo(3840);
    });

    test('游戏场景 - 保持完整可视区域', () => {
      const adapter = new ScreenAdapter({
        designWidth: 1920,
        designHeight: 1080,
        scaleMode: 'fit'
      });

      const transform = adapter.calculateResolutionTransform(0, 0, 2560, 1440);

      // 确保所有设计区域都可见
      expect(transform.viewportWidth).toBeGreaterThanOrEqual(1920 * (1440 / 1080) * 0.99);
      expect(transform.viewportHeight).toBeGreaterThanOrEqual(1440 * 0.99);
    });
  });
});
