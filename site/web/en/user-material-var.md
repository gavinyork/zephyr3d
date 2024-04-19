# Shader Variants

A common scenario is that after setting various properties of a material,
it needs to generate different codes, meaning that the shader of the same
material may have different variants.

You can use the static method [defineFeature()](/doc/markdown/./scene.meshmaterial.definefeature) to declare variants for a material.

```javascript

class MyMaterial extends MeshMaterial {
  // Define a Feature that can have several variants.
  static featureA = this.defineFeature();
  // Define another feature
  static featureB = this.defineFeature();

  foo() {
    /*
      Activating a variant can be achieved by calling the useFeature() method.
      The value parameter can be any value, and each different value represents
      a variant. The initial value for any feature is undefined.
     */
    this.useFeature(MyMaterial.featureA, value);
    // Get current variant value.
    const value = this.featureUsed(MyMaterial.featureA);
  }
  bar() {
    // Boolean values can be used as variants for simple switches.
    this.useFeature(MyMaterial.featureB, true);
  }
}

```

In the example below, we define a Lambert material that you can optionally texture, resulting in two shader variants.

```javascript

// Whether the diffuseTexture attribute of the material is empty or not represents a variant
class MyLambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  static featureDiffuseTexture = this.defineFeature();
  constructor() {
    super();
    // Diffuse color
    this.color = new Vector4(1, 1, 1, 1);
    // Diffuse texture，default to null
    this.diffuseTexture = null;
  }
  // Update variant values before applying material
  apply(ctx) {
    this.useFeature(MyLambertMaterial.featureDiffuseTexture, !!this.diffuseTexture);
    // Default implementation must be invoked.
    return super.apply(ctx);
  }
  supportLighting() {
    return true;
  }
  // vertex shader implementation
  // This implementation is the same as the previous example.
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.normal = pb.vec3().attrib('normal');
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    // Identify variants
    if (this.diffuseTexture) {
      scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
      scope.$outputs.texcoord = scope.$inputs.texcoord;
    }
  }
  // fragment shader implementation
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.diffuseColor = pb.vec4().uniform(2);
      // Identify variants
      if (this.diffuseTexture) {
        scope.diffuseTexture = pb.tex2D().uniform(2);
      }
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      // Identify variants
      if (this.diffuseTexture) {
        scope.$l.diffuse = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);
      } else {
        scope.$l.diffuse = scope.diffuseColor;
      }
      // Calcuate lighting.
      scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.diffuse);
      // Output fragment color
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.diffuse.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup, ctx, pass){
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('diffuseColor', this.color);
      if (this.diffuseTexture) {
        bindGroup.setTexture('diffuseTexture', this.diffuseTexture)
      }
    }
  }
}

```

In this example, pressing the spacebar toggles between two variations with and without diffuse texture.

<div class="showcase" case="tut-43"></div>

