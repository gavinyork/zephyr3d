import { Vector3, Vector4 } from '@zephyr3d/base';
import { GLTFImporter } from '@zephyr3d/loaders';
import type { SceneNode, Material, PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  Mesh,
  SphereShape,
  BoxShape,
  TorusShape,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { WoodMaterial } from './materials/wood';
import { FurMaterial } from './materials/fur';
import type { DeviceBackend, Texture2D } from '@zephyr3d/device';
import { ParallaxMapMaterial } from './materials/parallax';
import { ToonMaterial } from './materials/toon';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Panel } from './ui';
import { SceneColorMaterial } from './materials/scenecolor';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

async function getBackend(): Promise<DeviceBackend> {
  const type = getQueryString('dev') || 'webgl2';
  if (type === 'webgpu') {
    if (await backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  return backendWebGL2;
}

async function fetchModel(scene: Scene, url: string) {
  return url ? await getEngine().resourceManager.fetchModel(url, scene) : null;
}

const myApp = new Application({
  backend: await getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());
  const scene = new Scene();

  let dlight: DirectionalLight = null;
  // Create directional light
  dlight = new DirectionalLight(scene);
  // light direction
  dlight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  // light color
  dlight.color = new Vector4(1, 1, 1, 1);

  const meshes: { node: SceneNode; material: Material; name: string }[] = [];

  // Fur material
  const furColorTex = await getEngine().resourceManager.fetchTexture<Texture2D>(
    'https://cdn.zephyr3d.org/doc/assets/images/fur-color.png'
  );
  furColorTex.samplerOptions = {
    addressU: 'repeat',
    addressV: 'repeat'
  };
  const furAlphaTex = await getEngine().resourceManager.fetchTexture<Texture2D>(
    'https://cdn.zephyr3d.org/doc/assets/images/fur-alpha.png'
  );
  furAlphaTex.samplerOptions = {
    addressU: 'repeat',
    addressV: 'repeat'
  };
  const furMaterial = new FurMaterial();
  furMaterial.alphaTexture = furAlphaTex;
  furMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  furMaterial.thickness = 0.05;
  furMaterial.numLayers = 30;
  furMaterial.noiseRepeat = 16;
  const furMesh = new Mesh(scene, new TorusShape(), furMaterial);
  meshes.push({ node: furMesh, material: furMaterial, name: 'Fur' });

  // Parallax mapping material
  const rocksTex = await getEngine().resourceManager.fetchTexture<Texture2D>(
    'https://cdn.zephyr3d.org/doc/assets/images/rocks.jpg'
  );
  const rocksNHTex = await getEngine().resourceManager.fetchTexture<Texture2D>(
    'https://cdn.zephyr3d.org/doc/assets/images/rocks_NM_height.tga'
  );
  const parallaxMaterial = new ParallaxMapMaterial();
  parallaxMaterial.shininess = 8;
  parallaxMaterial.mode = 'occlusion';
  parallaxMaterial.parallaxScale = 0.5;
  parallaxMaterial.maxParallaxLayers = 120;
  parallaxMaterial.albedoTexture = rocksTex;
  parallaxMaterial.normalTexture = rocksNHTex;
  const parallaxMesh = new Mesh(scene, new BoxShape({ size: 4 }), parallaxMaterial);
  meshes.push({ node: parallaxMesh, material: parallaxMaterial, name: 'ParallaxMap' });

  // Wood material
  const woodMaterial = new WoodMaterial();
  const woodMesh = new Mesh(scene, new SphereShape({ radius: 2 }), woodMaterial);
  meshes.push({ node: woodMesh, material: woodMaterial, name: 'Wood' });

  // Toon material
  const toonMaterial = new ToonMaterial();
  toonMaterial.shadingToonyFactor = 0.9;
  toonMaterial.outlineWidthMode = 'worldCoordinates';
  toonMaterial.outlineWidthFactor = 0.01;
  const toonMesh = await fetchModel(scene, 'https://cdn.zephyr3d.org/doc/assets/models/Duck.glb');
  toonMesh.iterate((node) => {
    if (node.isMesh()) {
      toonMaterial.albedoTexture = (node.material as PBRMetallicRoughnessMaterial).albedoTexture;
      node.material = toonMaterial;
      node.useRenderBundle = false;
    }
  });
  meshes.push({ node: toonMesh, material: toonMaterial, name: 'Cartoon' });

  // Scene color material
  const sceneColorMaterial = new SceneColorMaterial();
  const sceneColorMesh = new Mesh(scene, new SphereShape({ radius: 2 }), sceneColorMaterial);
  meshes.push({ node: sceneColorMesh, material: sceneColorMaterial, name: 'SceneColor' });

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  camera.lookAt(new Vector3(0, 0, 12), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  //const inspector = new common.Inspector(scene, compositor, camera);

  getInput().use(camera.handleEvent.bind(camera));

  // UI
  //const ui = new UI(camera, meshes);

  new Panel(camera, meshes);

  myApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
    //ui.render();
  });

  myApp.run();
});
