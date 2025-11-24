# Light material

Creating materials that support lighting involves calculating all the direct and indirect lighting an object receives. You can utilize the lighting models already provided by the engine or write your own.

## Predefined lighting models

For custom materials, you can incorporate predefined lighting models from the system by using the applyMaterialMixins method. This allows you to call upon these models for lighting calculations.

The system currently offers the following predefined lighting models:

- Lambert Lighting Model

  Incorporate this by mixing in the [mixinLambert](/doc/markdown/./scene.mixinlambert) component, which provides the [lambertLight](/doc/markdown/./scene.imixinlambert) method for lighting calculations.

- Blinn-Phong Lighting Model:

  This requires mixing in the [mixinBlinnPhong](/doc/markdown/./scene.mixinblinnphong) component, which offers the [blinnPhongLight](/doc/markdown/./scene.imixinblinnphong) method for lighting calculations.

- PBRMetallicRoughness Lighting Model

  Mix in the [mixinPBRMetallicRoughness](/doc/markdown/./scene.mixinpbrmetallicroughness) component, which provides the [PBRLight](/doc/markdown/./scene.imixinpbrmetallicroughness) method for lighting calculations.

- PBRSpecularGlossiness Lighting Model:

  Incorporate this by mixing in the [mixinPBRSpecularGlossness](/doc/markdown/./scene.mixinpbrspecularglossness) component, which offers the [PBRLight](/doc/markdown/./scene.imixinpbrspecularglossiness) method for lighting calculations.

Mixing in any of these lighting models will automatically include the basic lighting component [mixinLight](/doc/markdown/./scene.mixinlight). This component offers interfaces for setting normal maps and calculating fragment normals and the TBN matrix, which are essential for lighting calculations.

Here's an example of a custom Blinn-Phong lighting material.

```javascript

// Customizing Blinn-Phong Material
class MyBlinnMaterial extends applyMaterialMixins(MeshMaterial, mixinBlinnPhong) {
  constructor() {
    super();
    // Diffuse color
    this.color = new Vector4(1, 1, 1, 1);
    // Diffuse texture
    this.diffuseTexture = null;
  }
  // Affected by illumination
  supportLighting() {
    return true;
  }
  // Vertex shader implementation
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    // Resolve the local space vertex position.
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    // Resolve the local space vertex normal.
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    // Define texture coordinate input.
    scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
    // Output the vertex position in world space to fragment shader.
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    // Output the vertex normal in world space to fragment shader.
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    // Output the texture coordinate to fragment shader.
    scope.$outputs.texcoord = scope.$inputs.texcoord;
    // Output the vertex position in clip space.
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  // Fragement shader implementation
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      // Define a vec4 type uniform to specify the diffuse color.
      scope.diffuseColor = pb.vec4().uniform(2);
      // Define uniform to specify the diffuse map.
      scope.diffuseTexture = pb.tex2D().uniform(2);
      /*
        Using the calculateNormal method provided by mixinLight,
        the fragment normals are calculated (if a normal map is set,
        this method will sample the normal map to calculate the
        fragment normals) for lighting calculation.
      */
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      // Calculate the view vector.
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      // Calculate the diffuse color.
      scope.$l.diffuseColor = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);
      /*
        Calculate the lighting, resulting in a vec3 type
        representing the color after illumination.
      */
      scope.$l.litColor = this.blinnPhongLight(scope, scope.$inputs.worldPos, scope.normal, scope.viewVec, scope.diffuseColor);
      // Output the final fragment color
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.diffuseColor.a));
    } else {
      // No need to calculate fragment color
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup, ctx, pass){
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('diffuseColor', this.color);
      bindGroup.setTexture('diffuseTexture', this.diffuseTexture)
    }
  }
}

const material = new MyBlinnMaterial();
// Set diffuse color
material.color.setXYZW(1, 1, 0, 1)
// Set diffuse texture
material.diffuseTexture = texture;
// Notify the uniform needs to be resubmitted
material.uniformChanged();

// Render the mesh using this material.
const mesh = new Mesh(scene, new TorusShape(), material);

```

<div class="showcase" case="tut-40"></div>

## Custom lighting

To customize lighting, you need to incorporate the [mixinLight](/doc/markdown/./scene.mixinlight) component. 

The example below demonstrates a Lambert material.

```javascript

// Custom lambert material
// We need to incorporate the mixinLight component
class MyLambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  constructor() {
    super();
    // Diffuse color.
    this.color = new Vector4(1, 1, 1, 1);
    // Diffuse texture.
    this.diffuseTexture = null;
  }
  supportLighting() {
    return true;
  }
  // vertex shader implementation
  // This implementation is the same as the previous example.
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    scope.$outputs.texcoord = scope.$inputs.texcoord;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  // fragment shader implementation
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.diffuseColor = pb.vec4().uniform(2);
      scope.diffuseTexture = pb.tex2D().uniform(2);
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      scope.$l.diffuseColor = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);

      // Here we calculate Lambertian lighting on our own.

      // Define a variable to store the contribution of lighting.
      scope.$l.litColor = pb.vec3(0);
      /*
        The method needCalculateEnvLight() is introduced by the mixinLight component
        and is used to check if there is a need to render indirect lighting.
        If a light source casts shadows, then the lighting needs to be rendered in
        multiple passes, with only the ambient light being rendered in the first pass.
       */
      if (this.needCalculateEnvLight()) {
        /*
          Need to render ambient light
          We use the getEnvLightIrradiance() method provided by the mixinLight component
          to obtain the environmental light irradiance.
          Here we disregard the radiance of ambient light.
        */
        scope.litColor = this.getEnvLightIrradiance(scope, scope.normal);
      }
      /*
        Use the forEachLight() method provided by the mixinLight component to iterate through
        all the light sources affecting this fragment.
        The second parameter is a callback function, with "this" referring to the current shader
        scope. The parameters are as follows:

        int type: 
          refers to the type of light source, which can be either LIGHT_TYPE_DIRECTIONAL,
          LIGHT_TYPE_POINT, or LIGHT_TYPE_SPOT.
        vec4 posRange: 
          represents the light source's world coordinates in the xyz components, and the
          light's range in the w component.
        vec4 dirCutoff:
          details the direction of the light in the xyz components, with the w component
          indicating the spotlight's attenuation factor.
        vec4 colorIntensity:
          consists of the light's color in the xyz components and the light's intensity
          in the w component.
        bool shadow:
          indicates whether the light source casts shadows.
       */
      const that = this;
      this.forEachLight(scope, function(type, posRange, dirCutoff, colorIntensity, shadow){
        /*
          Use the calculateLightAttenuation method provided by mixinLight to
          calculate light attenuation.
         */
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, this.worldPos, posRange, dirCutoff);
        /*
          Use the calculateLightDirection method provided by mixinLight to
          calculate the direction of light pointing towards the light source.
         */
        this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
        // Attenuated light color
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
        // Compute lighting using the lambert lighting model.
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.diffuse = pb.mul(this.lightColor, this.NoL);
        // Calculate the shadow if the light casts a shadow.
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, this.NoL));
          this.diffuse = pb.mul(this.diffuse, this.shadow);
        }
        // Accumulate the contributions of the light source.
        this.litColor = pb.add(this.litColor, this.diffuse);
      });
      // Calculating the final color.
      scope.$l.finalColor = pb.mul(pb.vec4(scope.litColor, 1), scope.diffuseColor);
      // Output the final color
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.finalColor);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup, ctx, pass){
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('diffuseColor', this.color);
      bindGroup.setTexture('diffuseTexture', this.diffuseTexture)
    }
  }
}

```

<div class="showcase" case="tut-41"></div>
