import * as zip from '@zip.js/zip.js';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { SceneNode, Material, PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
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
  TorusShape
} from '@zephyr3d/scene';
import { WoodMaterial } from './materials/wood';
import { FurMaterial } from './materials/fur';
import type { DeviceBackend, Texture2D } from '@zephyr3d/device';
import { ParallaxMapMaterial } from './materials/parallax';
import { ToonMaterial } from './materials/toon';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Panel } from './ui';
import { SceneColorMaterial } from './materials/scenecolor';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

function getBackend(): DeviceBackend {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgpu') {
    if (backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  if (type === 'webgl2') {
    if (backendWebGL2.supported()) {
      return backendWebGL2;
    } else {
      console.warn('No WebGL2 support, fall back to WebGL1');
    }
  }
  return backendWebGL1;
}

async function readZip(url: string): Promise<Map<string, string>> {
  const response = await fetch(url);
  const blob = await response.blob();
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  const entries = await reader.getEntries();
  const fileMap = new Map();
  for (const entry of entries) {
    if (!entry.directory) {
      const blob = await entry.getData(new zip.BlobWriter());
      const fileURL = URL.createObjectURL(blob);
      fileMap.set(`/${entry.filename}`, fileURL);
    }
  }
  await reader.close();
  // Make url unique so that a file url in zip will not conflict with other zip
  for (const key of Array.from(fileMap.keys())) {
    fileMap.set(url + key, fileMap.get(key));
  }
  return fileMap;
}

async function fetchModel(scene: Scene, url: string) {
  const assetManager = new AssetManager();
  if (/(\.zip)$/i.test(url)) {
    const fileMap = await readZip(url);
    url = Array.from(fileMap.keys()).find((val) => /(\.gltf|\.glb)$/i.test(val));
    assetManager.httpRequest.urlResolver = (url) => fileMap.get(url) || url;
  }
  return url ? await assetManager.fetchModel(scene, url) : null;
}

const myApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  const scene = new Scene();
  scene.env.sky.fogType = 'scatter';

  let dlight: DirectionalLight = null;
  // Create directional light
  dlight = new DirectionalLight(scene);
  // light direction
  dlight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  // light color
  dlight.color = new Vector4(1, 1, 1, 1);

  const meshes: { node: SceneNode; material: Material; name: string }[] = [];
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
  furMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  furMaterial.thickness = 0.05;
  furMaterial.numLayers = 30;
  furMaterial.noiseRepeat = 16;
  //const furMesh = await fetchModel(scene, 'assets/models/stanford-bunny.zip');
  const furMesh = new Mesh(scene, new TorusShape(), furMaterial);
  /*
  furMesh.group.iterate(node => {
    if (node.isMesh()) {
      furMaterial.albedoTexture = (node.material as PBRMetallicRoughnessMaterial).albedoTexture;
      node.material = furMaterial;
    }
  });
  */
  //const furMesh = new Mesh(scene, new SphereShape({ radius: 2 }), furMaterial);
  meshes.push({ node: furMesh, material: furMaterial, name: 'Fur' });

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
  const parallaxMesh = new Mesh(scene, new BoxShape({ size: 4 }), parallaxMaterial);
  meshes.push({ node: parallaxMesh, material: parallaxMaterial, name: 'ParallaxMap' });

  // Wood material
  const woodMaterial = new WoodMaterial();
  const woodMesh = new Mesh(scene, new SphereShape({ radius: 2 }), woodMaterial);
  meshes.push({ node: woodMesh, material: woodMaterial, name: 'Wood' });

  // Toon material
  const toonMaterial = new ToonMaterial();
  toonMaterial.bands = 2;
  toonMaterial.edgeThickness = 1;
  const toonMesh = await fetchModel(scene, 'assets/models/Duck.glb');
  toonMesh.group.iterate((node) => {
    if (node.isMesh()) {
      toonMaterial.albedoTexture = (node.material as PBRMetallicRoughnessMaterial).albedoTexture;
      node.material = toonMaterial;
    }
  });
  meshes.push({ node: toonMesh.group, material: toonMaterial, name: 'Cartoon' });

  // Scene color material
  const sceneColorMaterial = new SceneColorMaterial();
  const sceneColorMesh = new Mesh(scene, new SphereShape({ radius: 2 }), sceneColorMaterial);
  meshes.push({ node: sceneColorMesh, material: sceneColorMaterial, name: 'SceneColor' });

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    1000
  );
  camera.lookAt(new Vector3(0, 0, 12), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  //const inspector = new common.Inspector(scene, compositor, camera);

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // UI
  //const ui = new UI(camera, meshes);

  new Panel(camera, meshes);

  myApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
    //ui.render();
  });

  myApp.run();
});
