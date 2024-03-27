# Multi-pass material

Multi-pass materials enable the gradual construction of the final visual effect by
rendering the same object multiple times, with each render potentially utilizing
a different shader.

The engine's material system allows for multi-pass rendering of objects using a single
material, by simply setting the material's numPasses attribute.

In the example below, we achieve a simple cartoon effect using multi-pass materials.
The object is rendered twice:

1. The object is slightly expanded along the normal direction, and the back of the object is rendered with an outline color to simulate an outline effect. 
2. The object is rendered normally, and the continuous lighting is quantized into several areas to simulate a cartoon shading effect.

```javascript
// Use lambert lighting model
class CartoonMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  constructor() {
    super();
    // Number of color bands
    this.bands = 3;
    // Edge thickness
    this.edgeThickness = 0.3;
    // Object color
    this.color = new Vector4(1, 1, 1, 1);
    // Edge color
    this.edgeColor = new Vector4(0, 0, 0, 1);
    // Two passes
    this.numPasses = 2;
  }
  // Customize the rendering state for each Pass by overriding this method.
  updateRenderStates(pass, ctx) {
    // The default implementation must be called.
    super.updateRenderStates(pass, ctx);
    // Cull front face in the first pass, and the back face in the second pass.
    this.getRenderStateSet(pass).useRasterizerState().cullMode = pass === 0 ? 'front' : 'back';
  }
  applyUniformValues(bindGroup, ctx, pass) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      if (pass > 0) {
        bindGroup.setValue('albedoColor', this.color);
        bindGroup.setValue('bands', this.bands);
      } else {
        bindGroup.setValue('edge', this.edgeThickness);
        bindGroup.setValue('edgeColor', this.edgeColor);
      }
    }
  }
  // vertex shader implementation
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    // Resolve vertex position in local space
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    // Resolve vertex normal in local space
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    /*
      The "pass" attribute of the material indicates which pass
      the shader is currently being generated for.

      If it's the first pass, we need to expand the vertices outward
      along the normal direction.
     */
    if (this.pass === 0) {
      // Edge thickness uniform
      scope.edge = pb.float().uniform(2);
      // Expand the vertex along the normal.
      scope.oPos = pb.add(scope.oPos, pb.mul(scope.oNorm, scope.edge));
    }
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
  }
  // fragment shader implementation
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      if (this.pass === 0) {
        // The first pass needs to output the edge color.
        // Edge color uniform
        scope.edgeColor = pb.vec4().uniform(2);
        // Juse output the edge color
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.edgeColor);
      } else {
        // Object color uniform
        scope.albedoColor = pb.vec4().uniform(2);
        // Color bands uniform
        scope.bands = pb.float().uniform(2);
        // Calculate the world space normal
        scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.wNorm);
        /*
          Apply the lambert lighting
          To account for the presence of multiple light sources, we perform
          color quantization after completing all the illumination calculations.
        */
        scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.albedoColor);
        // For simplicity, use R+G+B as the brightness.
        scope.$l.litIntensity = pb.add(scope.litColor.r, scope.litColor.g, scope.litColor.b, 0.00001);
        scope.$l.albedoIntensity = pb.add(scope.albedoColor.r, scope.albedoColor.g, scope.albedoColor.g, 0.00001);
        // Calcuate the illumination.
        scope.$l.intensity = pb.clamp(pb.div(scope.litIntensity, scope.albedoIntensity), 0, 1);
        // Calculating the quantified intensity of light
        scope.intensity = pb.div(pb.ceil(pb.mul(scope.intensity, scope.bands)), scope.bands);
        // Recalculate fragment color
        scope.litColor = pb.mul(pb.vec3(scope.intensity), scope.albedoColor.rgb);
        // Output the final fragment color
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedoColor.a));
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}

```

<div class="showcase" case="tut-42"></div>
