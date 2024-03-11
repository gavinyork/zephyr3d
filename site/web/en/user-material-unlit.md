# Unlit Material

Here's a simple example where we define a material unaffected by lighting, showcasing some edge lighting effects.

```javascript

// Edge Light Material
class RimColorMaterial extends MeshMaterial {
  constructor() {
    super();
    // The Color of Edge Light
    this.color = new Vector3(1, 1, 1);
  }
  // Unaffected by illumination
  supportLighting() {
    return false;
  }
  /*
    vertex shader implementation
    The scope parameter is the scope of the main function in the vertex shader.
  */
  vertexShader(scope) {
    /*
      Must invoke the parent class's implementation.
      The parent class's vertex shader is responsible for initializing global uniform
      parameters and defining skeletal animation-related vertex attributes when necessary.
    */
    super.vertexShader(scope);
    const pb = scope.$builder;
    /*
      Define vertex position input. 
      This line can be omitted if the ShaderHelper.resolveVertexPosition() function is used.
    */
    scope.$inputs.pos = pb.vec3().attrib('position');
    /*
      Define vertex normal input.
      This line can be omitted if the ShaderHelper.resolveVertexNormal() function is used.
    */
    scope.$inputs.normal = pb.vec3().attrib('normal');
    /*
      The ShaderHelper.resolveVertexPosition() function calculates the vertex position in the
      local coordinate system. If there is skeletal animation, it computes the vertex position
      after skeletal operations; otherwise, it returns the input vertex position.
    */
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    /*
      The ShaderHelper.resolveVertexNormal() function calculates the vertex normal in the
      local coordinate system. If there is skeletal animation, it computes the vertex normal
      after skeletal operations; otherwise, it returns the input vertex normal.
    */
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    /*
      Calculate the vertex position in the world coordinate system and output them to the fragment shader. 
      The ShaderHelper.getWorldMatrix() function is used to obtain the current local-to-world position transformation matrix. 
      The scope.$outputs scope is used to define varying variables.
    */
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    /*
      Calculate the vertex normal in the world coordinate system and output them to the fragment shader. 
      The ShaderHelper.getNormalMatrix() function is used to obtain the current local-to-world normal transformation matrix. 
    */
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    /*
      Output the vertex coordinates in clip space. 
      Use ShaderHelper.getViewProjectionMatrix() to obtain the current transformation matrix from world space to clip space.
      Be cautious not to directly assign values to scope.$builtins.position, use the ShaderHelper.setClipSpacePosition() method instead.
    */
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  /*
    fragment shader implementation
    The scope parameter is the scope of the main function in the fragment shader.
  */
  fragmentShader(scope) {
    /*
      Must invoke the parent class's implementation.
      The parent class's fragment shader is responsible for initializing global uniform
    */
    super.fragmentShader(scope);
    const pb = scope.$builder;
    /*
      The needFragmentColor() function in MeshMaterial determines
      whether the current Shader needs to calculate the fragment color.
      It's not necessary to calculate the fragment color if the current
      RenderPass is either DepthPass or ShadowMapPass, and the material's
      alphaCutoff property is set to 0, indicating that AlphaTest is not enabled.
    */
    if (this.needFragmentColor()) {
      /*
        Define a vec3 type uniform to specify the edge light color.
        Note: For uniforms used in materials, the corresponding BindGroup index is 2.
      */
      scope.rimColor = pb.vec3().uniform(2);
      /*
        Calculating the View Vector.
        The function ShaderHelper.getCameraPosition() is used to obtain the
        current camera's position in world space.
        The scope.$inputs domain stores the varying variables.
      */
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      /*
        Calculate NdotV.
        The smaller the value, the brighter the edge lighting.
      */
      scope.$l.NdotV = pb.clamp(pb.dot(pb.normalize(scope.$inputs.worldNorm), scope.viewVec), 0, 1);
      /*
        Calculate the final fragment color.
      */
      scope.$l.finalColor = pb.mul(scope.rimColor, pb.pow(pb.sub(1, scope.NdotV), 4));
      /*
        The outputFragmentColor() method of the material is used to output
        the fragment color. This method performs clipping plane tests and
        alpha test when necessary, processes the fragment's alpha channel
        based on whether the material is translucent, and performs gamma correction
        as needed.
      */
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.finalColor, 1));
    } else {
      /*
        If there's no need to calculate the fragment color, then output null directly.
      */
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  // Setting Uniform Constants
  applyUniformValues(bindGroup, ctx, pass){
    // Must invoke the parent class's implementation.
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      // This Uniform is defined only when the fragment color needs to be calculated.
      bindGroup.setValue('rimColor', this.color);
    }
  }
}

// Using Custom Materials.
const material = new RimColorMaterial();
// Set edge color to yellow.
material.color.setXYZ(1, 1, 0)
/*
  Material uniforms are cached, and when a material uniform
  changes, the uniformChanged() method must be called to
  notify the material that the uniform needs to be resubmitted.
*/
material.uniformChanged();

// Render the mesh using this material.
const mesh = new Mesh(scene, new TorusShape(), material);

```

<div class="showcase" case="tut-39"></div>
