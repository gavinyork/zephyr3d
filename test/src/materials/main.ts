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
  BoxShape,
  SceneNode,
  Material,
  PBRMetallicRoughnessMaterial
} from '@zephyr3d/scene';
import { imGuiInit, imGuiInjectEvent } from '@zephyr3d/imgui';
import * as common from '../common';
import { WoodMaterial } from './materials/wood';
import { FurMaterial } from './materials/fur';
import type { Texture2D } from '@zephyr3d/device';
import { ParallaxMapMaterial } from './materials/parallax';
import { UI } from './ui';
import { ToonMaterial } from './materials/toon';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  await imGuiInit(myApp.device);

  const scene = new Scene();
  scene.env.sky.drawGround = true;
  let dlight: DirectionalLight = null;
  // Create directional light
  dlight = new DirectionalLight(scene);
  // light direction
  dlight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0, 'ZYX');
  // light color
  dlight.color = new Vector4(1, 1, 1, 1);


  const meshes: { node: SceneNode, material: Material }[] = [];
  const assetManager = new AssetManager();

  // Fur material
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
  const furMaterial = new FurMaterial();
  furMaterial.alphaTexture = furAlphaTex;
  const furMesh = await assetManager.fetchModel(scene, 'assets/models/stanford_bunny_pbr.glb');
  furMesh.group.iterate(node => {
    if (node.isMesh()) {
      furMaterial.albedoTexture = (node.material as PBRMetallicRoughnessMaterial).albedoTexture;
      node.material = furMaterial;
    }
  });
  //const furMesh = new Mesh(scene, new SphereShape({ radius: 2 }), furMaterial);
  meshes.push({ node: furMesh.group, material: furMaterial });

  // Parallax mapping material
  const rocksTex = await assetManager.fetchTexture<Texture2D>('assets/images/rocks.jpg');
  const rocksNHTex = await assetManager.fetchTexture<Texture2D>('assets/images/rocks_NM_height.tga');
  const parallaxMaterial = new ParallaxMapMaterial();
  parallaxMaterial.shininess = 8;
  parallaxMaterial.mode = 'occlusion';
  parallaxMaterial.parallaxScale = 0.5;
  parallaxMaterial.maxParallaxLayers = 120;
  parallaxMaterial.albedoTexture = rocksTex;
  parallaxMaterial.normalTexture = rocksNHTex;
  const parallaxMesh = new Mesh(scene, new BoxShape({ size: 4, anchorX: 0.5, anchorY: 0.5, anchorZ: 0.5 }), parallaxMaterial);
  meshes.push({ node: parallaxMesh, material: parallaxMaterial });

  // Wood material
  const woodMaterial = new WoodMaterial();
  const woodMesh = new Mesh(scene, new SphereShape({ radius: 2 }), woodMaterial);
  meshes.push({ node: woodMesh, material: woodMaterial });

  // Toon material
  const toonMaterial = new ToonMaterial();
  toonMaterial.bands = 4;
  toonMaterial.edgeThickness = 1;
  const toonMesh = await assetManager.fetchModel(scene, 'assets/models/Duck.glb');
  toonMesh.group.iterate(node => {
    if (node.isMesh()) {
      toonMaterial.albedoTexture = (node.material as PBRMetallicRoughnessMaterial).albedoTexture;
      node.material = toonMaterial;
    }
  });
  meshes.push({ node: toonMesh.group, material: toonMaterial });

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

  //const inspector = new common.Inspector(scene, compositor, camera);

  myApp.inputManager.use(imGuiInjectEvent);
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // UI
  const ui = new UI(camera, meshes);

  myApp.on('resize', (ev) => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
    ui.render();
  });

  myApp.run();
});
