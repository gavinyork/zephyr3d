import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  DirectionalLight,
  Mesh,
  SphereShape,
  AssetManager,
  BlinnMaterial,
  PlaneShape,
  BoxShape
} from '@zephyr3d/scene';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import * as common from '../common';
import { WoodMaterial } from './materials/wood';
import { FurMaterial } from './materials/fur';
import type { Texture2D } from '@zephyr3d/device';
import { ParallaxMapMaterial } from './materials/parallax';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  await imGuiInit(myApp.device);

  const scene = new Scene();

  let dlight: DirectionalLight = null;
  // Create directional light
  dlight = new DirectionalLight(scene);
  // light direction
  dlight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0, 'ZYX');
  // light color
  dlight.color = new Vector4(1, 1, 1, 1);

  const assetManager = new AssetManager();
  const furColorTex = await assetManager.fetchTexture<Texture2D>('assets/images/fur-color.png');
  furColorTex.samplerOptions = {
    addressU: 'repeat',
    addressV: 'repeat'
  };
  const furAlphaTex = await assetManager.fetchTexture<Texture2D>('assets/images/fur-alpha.png');
  furAlphaTex.samplerOptions = {
    addressU: 'repeat',
    addressV: 'repeat'
  };
  const rocksTex = await assetManager.fetchTexture<Texture2D>('assets/images/wood.jpg');
  const rocksNHTex = await assetManager.fetchTexture<Texture2D>('assets/images/four_NM_height.tga');
  // Create sphere
  const sphereMaterial = new WoodMaterial();
  const blinnMaterial = new BlinnMaterial();
  const furMaterial = new FurMaterial();
  furMaterial.albedoTexture = furColorTex;
  furMaterial.alphaTexture = furAlphaTex;
  const parallaxMaterial = new ParallaxMapMaterial();
  parallaxMaterial.shininess = 8;
  parallaxMaterial.parallaxScale = 0.5;
  parallaxMaterial.albedoTexture = rocksTex;
  parallaxMaterial.normalTexture = rocksNHTex;
  parallaxMaterial.stateSet.useRasterizerState().setCullMode('none');
  new Mesh(scene, new BoxShape({ size: 4, needTangent: true, anchorX: 0.5, anchorY: 0.5, anchorZ: 0.5 }), parallaxMaterial);

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    600
  );
  camera.lookAt(new Vector3(0, 0, 12), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: 12 });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  const inspector = new common.Inspector(scene, compositor, camera);

  myApp.inputManager.use(imGuiInjectEvent);
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);

    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });

  myApp.run();
});
