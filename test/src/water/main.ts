import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  FPSCameraController,
  Application,
  PerspectiveCamera,
  WaterMesh,
  WaterShaderImpl,
  AssetManager,
  panoramaToCubemap
} from '@zephyr3d/scene';
import * as common from '../common';
import { ImGui, imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { BindGroup, Texture2D, TextureCube } from '@zephyr3d/device';

const waterApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

waterApp.ready().then(async () => {
  const device = waterApp.device;
  const scene = new Scene();
  await imGuiInit(device);
  const camera = new PerspectiveCamera(scene, Math.PI / 3, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 260);
  camera.lookAt(new Vector3(0, -1, 30), new Vector3(0, -1, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController();

  waterApp.inputManager.use(imGuiInjectEvent);
  waterApp.inputManager.use(camera.handleEvent.bind(camera));

  const inspector = new common.Inspector(scene);

  const assetManager = new AssetManager();
  const hdr = await assetManager.fetchTexture<Texture2D>(`./assets/images/environments/cloudy.hdr`);
  const envMap = device.createCubeTexture('rgba16f', 512);
  panoramaToCubemap(hdr, envMap);


  const waterShaderImpl: WaterShaderImpl = {
    setupUniforms(scope) {
      const pb = scope.$builder;
      if (pb.shaderKind === 'fragment') {
        scope.envMap = pb.texCube().uniform(0);
      }
    },
    shading(scope, worldPos, worldNormal) {
      const pb = scope.$builder;
      return pb.vec4(pb.add(pb.mul(worldNormal, 0.5), pb.vec3(0.5)), 1);
      //return pb.textureSample(scope.envMap, worldNormal);
    }
  }

  const waterMesh = new WaterMesh(device, waterShaderImpl);
  waterMesh.bindGroup.setTexture('envMap', envMap);
  function showWaterInspector() {
    if (ImGui.Begin('water settings')) {
      const wireframe = [waterMesh.wireframe] as [boolean];
      if (ImGui.Checkbox('Wireframe', wireframe)) {
        waterMesh.wireframe = wireframe[0];
      }
      const gridScale = [waterMesh.gridScale] as [number];
      if (ImGui.SliderFloat('GridScale', gridScale, 0, 8)) {
        waterMesh.gridScale = gridScale[0];
      }
      const tileSize = [waterMesh.tileSize] as [number];
      if (ImGui.SliderInt('TileSize', tileSize, 2, 64)) {
        waterMesh.tileSize = tileSize[0];
      }
      ImGui.SliderFloat2('RegionMin', waterMesh.regionMin, -1000, 1000);
      ImGui.SliderFloat2('RegionMax', waterMesh.regionMax, -1000, 1000);
      const tmpWind = new Vector2(waterMesh.wind);
      if (ImGui.SliderFloat2('Wind', tmpWind, 0, 32)) {
        waterMesh.wind = tmpWind;
      }
      const alignment = [ waterMesh.params.alignment ] as [number];
      if (ImGui.SliderFloat('alignment', alignment, 0, 4)) {
        waterMesh.alignment = alignment[0];
      }
      for (let i = 0; i < 3; i++) {
        const size = [ waterMesh.params.cascades[i].size ] as [number];
        if (ImGui.SliderFloat(`Size${i}`, size, 0, 1000)) {
          waterMesh.setWaveLength(i, size[0]);
        }
        const strength = [ waterMesh.params.cascades[i].strength ] as [number];
        if (ImGui.SliderFloat(`Strength${i}`, strength, 0, 10)) {
          waterMesh.setWaveStrength(i, strength[0]);
        }
        const croppiness = [ waterMesh.params.cascades[i].croppiness ] as [number];
        if (ImGui.SliderFloat(`Croppiness${i}`, croppiness, -2, 2)) {
          waterMesh.setWaveCroppiness(i, croppiness[0]);
        }
      }
    }
    ImGui.End();
  }

  waterApp.on('resize', ev => {
    console.log(`Camera resize to ${ev.width}x${ev.height}`);
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  waterApp.on('tick', () => {
    if (waterApp.canRender) {
      camera.updateController();
      device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
      waterMesh.render(camera);

      imGuiNewFrame();
      inspector.render();
      showWaterInspector();
      imGuiEndFrame();
    }
  });
  waterApp.run();
});
