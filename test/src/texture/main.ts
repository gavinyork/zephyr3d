import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { floatToHalf, halfToFloat, unpackFloat3, Vector4 } from '@zephyr3d/base';
import { AssetManager, Application } from '@zephyr3d/scene';
import * as common from '../common';
import {
  TestTexture2D,
  TestTexture2DArray,
  TestTexture3D,
  TestTextureCube,
  TestTextureCubeSH,
  TestTextureVideo
} from './case';
import { packFloat3 } from '@zephyr3d/base';
import { Inspector } from '@zephyr3d/inspector';

const test2D = true;
const test3D = true;
const testCube = true;
const testCubeSH = true;
const test2DArray = true;
const testVideo = true;

const testValues = [
  [1, 1, 1],
  [0, 0, 0],
  [100, 100, 100],
  [0.2, 0.8, 0.1],
  [10000, 50, 381.5],
  [800000, 90000, -50]
];
const test: number[] = [];
for (const v of testValues) {
  const pk = packFloat3(v[0], v[1], v[2]);
  console.log(`packeFloat3(${v[0]}, ${v[1]}, ${v[2]}) = ${(pk >>> 0).toString(16)}`);
  unpackFloat3(pk, test);
  console.log(`unpackFloat3(0x${pk >>> 0}) = ${test}`);
}
const testFloatHalfValues = [-1000000, -500, -3.123, 0, 0.812, 5.4434, 1000.32, 10000.1, 500000.5];
for (const v of testFloatHalfValues) {
  const half = floatToHalf(v);
  console.log(`floatToHalf(${v}) = ${(half >>> 0).toString(16)}`);
  const f = halfToFloat(half);
  console.log(`halfToFloat(0x${half >>> 0}) = ${f}`);
}

const textureApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

textureApp.ready().then(async () => {
  const device = textureApp.device;
  await imGuiInit(device);
  const inspector = new Inspector(null, null);
  textureApp.inputManager.use(imGuiInjectEvent);
  const assetManager = new AssetManager();
  function getSubViewport(index: number) {
    const width = (device.deviceToScreen(device.getDrawingBufferWidth()) / 3) >> 0;
    const height = (device.deviceToScreen(device.getDrawingBufferHeight()) / 2) >> 0;
    return [(index % 3) * width, ((index / 3) >> 0) * height, width, height];
  }
  const case2d = new TestTexture2D(assetManager);
  await case2d.init();
  const case3d = device.type === 'webgl' ? null : new TestTexture3D(assetManager);
  await case3d?.init();
  const caseCube = new TestTextureCube(assetManager);
  await caseCube.init();
  const caseCubeSH = new TestTextureCubeSH(assetManager);
  await caseCubeSH.init();
  const case2dArray = device.type === 'webgl' ? null : new TestTexture2DArray(assetManager);
  await case2dArray?.init();
  const caseVideo = new TestTextureVideo(assetManager, './assets/images/sample-video.mp4');
  await caseVideo.init();

  textureApp.on('tick', () => {
    device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
    device.pushDeviceStates();
    {
      const vp = getSubViewport(0);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (test2D) {
        case2d.draw(vp[2], vp[3]);
      }
    }
    {
      const vp = getSubViewport(1);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (test3D) {
        case3d?.draw(vp[2], vp[3]);
      }
    }
    {
      const vp = getSubViewport(2);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (test2DArray && case2dArray) {
        case2dArray.draw(vp[2], vp[3]);
      }
    }
    {
      const vp = getSubViewport(3);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (testCubeSH) {
        caseCubeSH.draw(vp[2], vp[3]);
      }
    }
    {
      const vp = getSubViewport(4);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (testCube) {
        caseCube.draw(vp[2], vp[3]);
      }
    }
    {
      const vp = getSubViewport(5);
      device.setViewport(vp);
      device.setScissor(vp);
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      if (testVideo) {
        caseVideo.draw(vp[2], vp[3]);
      }
    }
    device.popDeviceStates();
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });

  textureApp.run();
});
