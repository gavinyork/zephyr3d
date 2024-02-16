import { Vector3, Vector4 } from '@zephyr3d/base';
import type {
  TextureSampler,
  TextureCube,
  Texture2D,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import type { SceneNode, Material } from '@zephyr3d/scene';
import {
  Mesh,
  AssetManager,
  DirectionalLight,
  OrbitCameraController,
  Scene,
  Camera,
  GraphNode,
  UnlitLightModel,
  StandardMaterial,
  PBRMetallicRoughnessMaterial,
  ShaderFramework,
  Application,
  Tonemap,
  BUILTIN_ASSET_TEST_CUBEMAP,
  PerspectiveCamera,
  SphereShape,
  Compositor
} from '@zephyr3d/scene';
import { getBackend } from '../common';

class ReflectLightModel extends UnlitLightModel {
  private _reflectTexture: TextureCube;
  private _reflectTextureSampler: TextureSampler;
  constructor(reflectTexture: TextureCube) {
    super();
    this._reflectTexture = reflectTexture;
    this._reflectTextureSampler = reflectTexture?.getDefaultSampler(false);
    this.setTextureOptions('reflection', this._reflectTexture, this._reflectTextureSampler, null, null);
  }
  isNormalUsed(): boolean {
    return true;
  }
  calculateAlbedo(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    const reflectTexture = scope[this.getTextureUniformName('reflection')];
    const v = pb.normalize(pb.sub(scope.$inputs.worldPosition.xyz, ShaderFramework.getCameraPosition(scope)));
    const r = pb.reflect(v, pb.normalize(scope.$inputs.worldNormal));
    return pb.textureSample(reflectTexture, r);
  }
}

const cmApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas')
});
cmApp.ready().then(async () => {
  const device = cmApp.device;
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    160
  );
  camera.lookAt(new Vector3(0, 0, 30), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ distance: camera.position.magnitude });
  cmApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  const rtCamera = new Camera(scene);
  const renderTexture = device.createCubeTexture('rgba8unorm', 512);
  const depthAttachment = device.createTexture2D('d24s8', 512, 512);
  rtCamera.framebuffer = device.createFrameBuffer([renderTexture], depthAttachment);
  const assetManager = new AssetManager();
  const material = new StandardMaterial<ReflectLightModel>();
  material.lightModel = new ReflectLightModel(renderTexture);
  // const skyMap = await assetManager.fetchTexture<TextureCube>('./assets/images/sky2.dds', null, true);
  const skyMap = await assetManager.fetchBuiltinTexture<TextureCube>(BUILTIN_ASSET_TEST_CUBEMAP);
  scene.env.sky.skyType = 'skybox';
  scene.env.sky.skyboxTexture = skyMap;
  const reflectiveSphere = await assetManager.fetchModel(scene, './assets/models/Avocado.glb');
  reflectiveSphere.group.scale.setXYZ(200, 200, 200);
  function changeMaterial(node: SceneNode, mat: Material) {
    if (node.isMesh()) {
      node.material = mat;
    }
    for (const child of node.children) {
      changeMaterial(child, mat);
    }
  }
  changeMaterial(reflectiveSphere.group, material);
  // const reflectiveSphere = new SphereMesh(scene, { radius: 10, material: material });
  const light = new DirectionalLight(scene)
    .setColor(new Vector4(1, 1, 1, 1))
    .setIntensity(1)
    .setCastShadow(false);
  light.lookAt(new Vector3(10, 10, 10), new Vector3(0, 0, 0), Vector3.axisPY());

  const stdMat = new PBRMetallicRoughnessMaterial();
  const albedoMap = await assetManager.fetchTexture<Texture2D>('./assets/images/rustediron2_basecolor.png');
  stdMat.albedoTexture = albedoMap;
  const normalMap = await assetManager.fetchTexture<Texture2D>('./assets/images/rustediron2_normal.png', {
    linearColorSpace: true
  });
  stdMat.normalTexture = normalMap;
  const metallicMap = await assetManager.fetchTexture<Texture2D>('./assets/images/mr.png', {
    linearColorSpace: true
  });
  stdMat.metallicRoughnessTexture = metallicMap;

  const sphere = new SphereShape();
  const spheres0 = new Mesh(scene, sphere);
  spheres0.name = 'sphere0';
  spheres0.material = stdMat;
  spheres0.scale.setXYZ(3, 3, 3);

  const spheres1 = new Mesh(scene, sphere);
  spheres1.name = 'sphere1';
  spheres1.material = stdMat;
  spheres1.scale.setXYZ(3, 3, 3);

  const spheres2 = new Mesh(scene, sphere);
  spheres2.name = 'sphere2';
  spheres2.material = stdMat;
  spheres2.scale.setXYZ(3, 3, 3);

  cmApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  cmApp.on('tick', () => {
    reflectiveSphere.group.showState = GraphNode.SHOW_HIDE;
    for (let i = 0; i < 6; i++) {
      rtCamera.framebuffer.setColorAttachmentCubeFace(0, i);
      rtCamera.lookAtCubeFace(i, Vector3.zero());
      rtCamera.render(scene);
    }
    reflectiveSphere.group.showState = GraphNode.SHOW_DEFAULT;

    const elapsed = cmApp.device.frameInfo.elapsedOverall;
    spheres0.position.setXYZ(20 * Math.sin(elapsed * 0.003), 0, 20 * Math.cos(elapsed * 0.003));
    spheres1.position.setXYZ(0, 20 * Math.sin(elapsed * 0.002), 20 * Math.cos(elapsed * 0.002));
    spheres2.position.setXYZ(20 * Math.sin(elapsed * 0.002), 20 * Math.cos(elapsed * 0.002), 0);
    camera.updateController();
    camera.render(scene, compositor);
  });

  cmApp.run();
});
