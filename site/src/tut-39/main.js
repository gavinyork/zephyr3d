import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, MeshMaterial, ShaderHelper, OrbitCameraController, Mesh, SphereShape } from '@zephyr3d/scene';

// Material definition
class MyMaterial extends MeshMaterial {
  constructor() {
    super();
    this.color = new Vector3(1, 1, 1);
  }
  supportLighting() {
    return false;
  }
  applyUniformValues(bindGroup, ctx, pass){
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('color', this._color);
    }
  }
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  fragmentShader(scope){
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      scope.color = pb.vec3().uniform(2);
      scope.$l.rgbNormal = pb.add(pb.mul(scope.$inputs.worldNorm, 0.5), pb.vec3(0.5));
      scope.$l.rgbNormal = pb.mul(scope.$l.rgbNormal, scope.color);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.rgbNormal, 1));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const device = myApp.device;

  const scene = new Scene();
  //scene.env.sky.skyType = 'scatter';
  const material = new MyMaterial();
  material.color = new Vector3(1, 0, 0);
  material.uniformChanged();

  new Mesh(scene, new SphereShape({ radius: 2 }), material);

  const camera = new PerspectiveCamera(scene, Math.PI/3, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 500);
  camera.lookAt(new Vector3(5, 0, 0), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', ev => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
