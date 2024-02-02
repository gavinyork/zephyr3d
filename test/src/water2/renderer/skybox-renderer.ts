import OBJ from '../assets/objects/shapes';

import { Geometry, Gpu, ShaderProgram, Camera, Cubemap } from '../graphics';
import { loadObj } from '../utils';

import vs from './programs/skybox-vertex.glsl';
import fs from './programs/skybox-fragment.glsl';

export class SkyboxRenderer {
  private readonly shader: ShaderProgram;
  private geometry: Geometry;

  public constructor(private readonly gpu: Gpu) {
    this.shader = this.gpu.createShaderProgram(vs, fs);
    this.geometry = this.createGeometry();
  }

  public render(camera: Camera, skybox: Cubemap) {
    this.gpu.setViewport(
      0,
      0,
      this.gpu.context.canvas.width,
      this.gpu.context.canvas.height
    );
    this.gpu.setProgram(this.shader);
    this.gpu.setProgramCubemap(this.shader, 'env', skybox, 0);
    // this.gpu.setProgramVariable(this.shader, 'exposure', 'float', 3.0);
    this.gpu.setProgramVariable(this.shader, 'gamma', 'float', 2.2);
    this.gpu.setProgramVariable(this.shader, 'viewMat', 'mat4', camera.view);
    this.gpu.setProgramVariable(
      this.shader,
      'projMat',
      'mat4',
      camera.projection
    );

    this.gpu.setCullFace(WebGL2RenderingContext.CW);
    this.gpu.enableDepthWrite(false);
    this.gpu.drawGeometry(this.geometry);
    this.gpu.enableDepthWrite(true);
    this.gpu.setCullFace(WebGL2RenderingContext.CCW);
  }

  private createGeometry() {
    const obj = loadObj(OBJ);
    return this.gpu.createGeometry(obj['cube']);
  }
}
