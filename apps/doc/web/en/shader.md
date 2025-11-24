# Writing shaders

Due to the need for cross-graphic API compatibility, we dynamically generate GLSL or WGSL code based on the device type using native JavaScript.

Here is an example of generating a Shader:

```javascript

// Creating shader via javascript
const program = device.buildRenderProgram({
  vertex(pb) {
    this.$inputs.pos = pb.vec3().attrib('position');
    this.$inputs.uv = pb.vec2().attrib('texCoord0');
    this.mvpMatrix = pb.mat4().uniform(0);
    pb.main(function(){
      this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
      this.$outputs.outUV = this.$inputs.uv;
    });
  },
  fragment(pb) {
    this.$outputs.color = pb.vec4();
    this.tex = pb.tex2D().uniform(0);
    this.factor = pb.vec4().uniform(0);
    pb.main(function(){
      this.sampleColor = pb.textureSample(this.tex, this.$inputs.outUV);
      this.$outputs.color = pb.mul(this.sampleColor, this.factor);
    });
  }
});

// The generated vertex shader code
console.log(program.getShaderSource('vertex'));
// The generated fragment shader code
console.log(program.getShaderSource('fragment'));

```

We use the method [buildRenderProgram()](/doc/markdown/./device.abstractdevice.buildrenderprogram) to create shaders for rendering. The parameters vertex() and fragment() are the generation functions for vertex shader and fragment shader, respectively.

The two generation functions accept a parameter ```pb``` (ProgramBuilder), which is the main interface object for generating Shaders. It provides definitions for data types in Shaders, process control, as well as definitions for built-in variables and functions within Shaders. The generation functions cannot be arrow functions, as their implicit 'this' refers to the global scope of the Shader.

## Scope

In the context of shader generation functions, the concept of scope is similar to that in shader code. Within a scope, you can define constants and variables. In the global scope, you can define the inputs and outputs of the shader, as well as uniform constants. Within the function scope, you can perform branching and looping, which are also implemented through generation functions and have their own scopes. When accessing variables or constants within a scope, the system will search upwards along the scope chain.

## Entry Function

The global scope calls [pb.main()](/doc/markdown/./device.programbuilder.main) to create the entry function for the Shader, with the parameter being a generator function (where 'this' points to the scope).


```javascript

const program = device.buildRenderProgram({
  vertex(pb){
    // THIS here refers to the global scope

    // VertexShader entry point
    pb.main(function(){
      // THIS here refers to the function scope
    });
  },
  fragment(pb){
    // FragmentShader entry point
    pb.main(function(){
    });
  }
});

```

## Variables

Global scope allows for the definition of global variables, while other scopes can define local variables within blocks.

```javascript

vertex(pb) {
  // Declare a global variable of type vec4
  this.x = pb.vec4();
  // Declare and initialize global variables
  this.y = pb.vec4(1, 2, 3, 4);
}

```

The above code generates GLSL:

```
vec4 x;
vec4 y = vec4(1.0,2.0,3.0,4.0);
```

The above code generates WGSL:

```
var<private> x: vec4<f32>;
var<private> y: vec4<f32> = vec4<f32>(1.0,2.0,3.0,4.0);
```

The code below defines a local variable within the function scope.

```javascript

vertex(pb) {
  pb.main(function(){
    // THIS is the scope of the entry function
    this.x = pb.vec4(1);
  });
}

```

If there is a variable with the same name in the parent scope, the statement becomes an assignment to the variable with the same name in the parent scope, as shown in the following example:

```javascript

vertex(pb) {  
  this.x = pb.vec4();
  pb.main(function(){
    // Variable x already exists in the parent scope, and the following is the assignment statement
    this.x = pb.vec4(1);
  });
}

```

Generated GLSL:

```
vec4 a;
void main() {
  a = vec4(1.0);
}
```

If we indeed need to declare local variables, regardless of whether there are variables with the same name in the parent scope, we need to explicitly specify the current scope, as shown in the following example:

```javascript

vertex(pb) {  
  this.x = pb.vec4();
  pb.main(function(){
    // Call $l to get the current scope
    this.$l.x = pb.vec4(1);
    // At this point, the variable x already exists in the current scope, which becomes the assignment
    this.$l.x = pb.vec4(2);
  });
}

```

Generated GLSL:

```
vec4 a;
void main() {
  vec4 a = vec4(1.0);
  a = vec4(2.0);
}
```


We support the following Shader data types

|type|constructor|WebGL/WebGL2|WebGPU|
|--|--|--|--|
|float|```this.x = pb.float()```|```float x;```|```var x: f32;```|
|vec2|```this.x = pb.vec2()```|```vec2 x;```|```var x: vec2<f32>;```|
|vec3|```this.x = pb.vec3()```|```vec3 x;```|```var x: vec3<f32>;```|
|vec4|```this.x = pb.vec4()```|```vec4 x;```|```var x: vec4<f32>;```|
|int|```this.x = pb.int()```|```int x;```|```var x: i32;```|
|ivec2|```this.x = pb.ivec2()```|```ivec2 x;```|```var x: vec2<i32>;```|
|ivec3|```this.x = pb.ivec3()```|```ivec3 x;```|```var x: vec3<i32>;```|
|ivec4|```this.x = pb.ivec4()```|```ivec4 x;```|```var x: vec4<i32>;```|
|uint|```this.x = pb.uint()```|```uint x;```|```var x: u32;```|
|uvec2|```this.x = pb.uvec2()```|```uvec2 x;```|```var x: vec2<u32>;```|
|uvec3|```this.x = pb.uvec3()```|```uvec3 x;```|```var x: vec3<u32>;```|
|uvec4|```this.x = pb.uvec4()```|```uvec4 x;```|```var x: vec4<u32>;```|
|bool|```this.x = pb.bool()```|```bool x;```|```var x: bool;```|
|bvec2|```this.x = pb.bvec2()```|```bvec2 x;```|```var x: vec2<bool>;```|
|bvec3|```this.x = pb.bvec3()```|```bvec3 x;```|```var x: vec3<bool>;```|
|bvec4|```this.x = pb.bvec4()```|```bvec4 x;```|```var x: vec4<bool>;```|
|mat2|```this.x = pb.mat2()```|```mat2 x;```|```var x: mat2x2<f32>;```|
|mat2x3|```this.x = pb.mat2x3()```|```mat2x3 x;```|```var x: mat2x3<f32>;```|
|mat2x4|```this.x = pb.mat2x4()```|```mat2x4 x;```|```var x: mat2x4<f32>;```|
|mat3x2|```this.x = pb.mat3x2()```|```mat3x2 x;```|```var x: mat3x2<f32>;```|
|mat3|```this.x = pb.mat3()```|```mat3 x;```|```var x: mat3x3<f32>;```|
|mat3x4|```this.x = pb.mat3x4()```|```mat3x4 x;```|```var x: mat3x4<f32>;```|
|mat4x2|```this.x = pb.mat4x2()```|```mat4x2 x;```|```var x: mat4x2<f32>;```|
|mat4x3|```this.x = pb.mat4x3()```|```mat4x3 x;```|```var x: mat4x3<f32>;```|
|mat4|```this.x = pb.mat4()```|```mat4 x;```|```var x: mat4x4<f32>;```|
|tex2D|```this.x = pb.tex2D()```|```sampler2D x;```|```var x: texture_2d<f32>;```|
|itex2D|```this.x = pb.itex2D()```|```isampler2D x;```|```var x: texture_2d<i32>;```|
|utex2D|```this.x = pb.utex2D()```|```usampler2D x;```|```var x: texture_2d<u32>;```|
|tex2DShadow|```this.x = pb.tex2DShadow()```|```sampler2DShadow x;```|```var x: texture_depth_2d;```|
|tex2DArray|```this.x = pb.tex2DArray()```|```sampler2DArray x;```|```var x: texture_2d_array<f32>;```|
|itex2DArray|```this.x = pb.itex2DArray()```|```isampler2DArray x;```|```var x: texture_2d_array<i32>;```|
|utex2DArray|```this.x = pb.utex2DArray()```|```usampler2DArray x;```|```var x: texture_2d_array<u32>;```|
|tex2DArrayShadow|```this.x = pb.tex2DArrayShadow()```|```sampler2DArrayShadow x;```|```var x: texture_depth_2d_array;```|
|tex3D|```this.x = pb.tex3D()```|```sampler3D x;```|```var x: texture_3d<f32>;```|
|itex3D|```this.x = pb.itex3D()```|```isampler3D x;```|```var x: texture_3d<i32>;```|
|utex3D|```this.x = pb.utex3D()```|```usampler3D x;```|```var x: texture_3d<u32>;```|
|texCube|```this.x = pb.texCube()```|```samplerCube x;```|```var x: texture_cube<f32>;```|
|itexCube|```this.x = pb.itexCube()```|```isamplerCube x;```|```var x: texture_cube<i32>;```|
|utexCube|```this.x = pb.utexCube()```|```usamplerCube x;```|```var x: texture_cube<u32>;```|
|texCubeShadow|```this.x = pb.texCubeShadow()```|```samplerCubeShadow x;```|```var x: texture_depth_cube;```|
|texStorage2D|```this.x = pb.texStorage2D.rgba8unorm()```|N/A|```var x: texture_storage_2d<rgba8unorm, write>;```|
|texStorage2DArray|```this.x = pb.texStorage2DArray.rgba8unorm()```|N/A|```var x: texture_storage_2d_array<rgba8unorm, write>;```|
|texStorage3D|```this.x = pb.texStorage3D.rgba8unorm()```|N/A|```var x: texture_storage_3d<rgba8unorm, write>;```|

For variables that are not texture types, we can also define array types.

```javascript

vertex(pb){
  // Define a vec4 array of length 2
  this.x = pb.vec4[2]();
  // Define and initialize (not supported on WebGL1 device)
  this.y = pb.vec4[2](pb.vec4(1), pb.vec4(2));
}

```

Generated GLSL:

```
vec4 x[2];
vec4 y[2] = vec4[2](vec4(1.0),vec4(2.0));
```

Generated WGSL:

```
var<private> x: array<vec4<f32>, 2>;
var<private> y: array<vec4<f32>, 2> = array<vec4<f32>, 2>(vec4<f32>(1.0),vec4<f32>(2.0));
```

Two-dimensional arrays and variable-length array types are only supported on WebGPU devices.

```javascript

// Define a two-dimensional array of type vec4
this.x = pb.vec4[2][2]();

// Define a variable-length array
this.y = pb.vec4[0]();

```

Generated WGSL:

```
var<private> a: array<array<vec4<f32>, 2>, 2>;
```

We also support structured types. First, you need to define the constructor of the structure using the [pb.defineStruct()](/doc/markdown/./device.programbuilder.definestruct) function, and then use this constructor to create instances.

```javascript

vertex(pb){
  // Define a structure that contains two members,，{ vec4 a, vec3 b }
  const MyStruct = pb.defineStruct([pb.vec4('a'), pb.vec3('b')]);
  pb.main(function(){
    // Creates an instance of this structure type
    this.k = MyStruct();
    // Assign values to structure members
    this.k.a = pb.vec4(1);
    this.k.b.x = 0;
    this.k.b.y = 1;
    this.k.b.z = 2;
    // Construct and initialize the struct
    this.t = MyStruct(pb.vec4(1), pb.vec3(2));
  });
}

```

## Built-in scope

The built-in variable scope encompasses all the built-in variables within a Shader, which can be used directly without declaration.

```javascript

vertex(pb){
  // Obtain the built-in scope through the $builtins property.
  // vertexIndex corresponds to the gl_VertexID in GLSL or the @builtin@(vertex_index) in WebGPU
  this.$l.vertexId = this.$builtins.vertexIndex;
},

```

The table below contains all the built-in variables we currently support.

|Builtin variable|WebGL|WebGL2|WGSL|Stage|
|--|--|--|--|--|
|```$builtins.position```|gl_Position|gl_Position|$builtin(position)|vertex|
|```$builtins.pointSize```|gl_PointSize|gl_PointSize|N/A|vertex|
|```$builtins.fragCoord```|gl_FragCoord|gl_FragCoord|$builtin(position)|fragment|
|```$builtins.frontFacing```|gl_FrontFacing|gl_FrontFacing|@builtin(front_facing)|fragment|
|```$builtins.fragDepth```|gl_FragDepthEXT|gl_FragDepth|@builtin(frag_depth)|fragment|
|```$builtins.vertexIndex```|N/A|gl_VertexID|@builtin(vertex_index)|vertex|
|```$builtins.instanceIndex```|N/A|gl_InstanceID|@builtin(instance_index)|vertex|
|```$builtins.localInvocationId```|N/A|N/A|@builtin(local_invocation_id)|compute|
|```$builtins.globalInvocationId```|N/A|N/A|@builtin(global_invocation_id)|compute|
|```$builtins.workGroupId```|N/A|N/A|@builtin(workgroup_id)|compute|
|```$builtins.numWorkGroups```|N/A|N/A|@builtin(num_workgroups)|compute|
|```$builtins.sampleMaskIn```|N/A|N/A|@builtin(sample_mask_in)|fragment|
|```$builtins.sampleMaskOut```|N/A|N/A|@builtin(sample_mask_out)|fragment|
|```$builtins.sampleIndex```|N/A|N/A|@builtin(sample_index)|fragment|

## Input/Output scope

Inputs and outputs are two special scopes. In the context of VertexShader, the input scope exclusively comprises vertex inputs, while the output scope includes the Varying variables passed from the VertexShader to the FragmentShader. For the FragmentShader, its input scope is automatically generated from the VertexShader's output scope, eliminating the need for manual declaration. The output scope of the FragmentShader is solely dedicated to color outputs.

```javascript

vertex(pb){
  // The input scope of the VertexShader defines the vertex stream, which must call the attrib() method to specify the vertex semantic.
  this.$inputs.pos = pb.vec3().attrib('position');
  this.$inputs.color = pb.vec4().attrib('diffuse');
  // Define the Varying output variable
  this.$outputs.outColor = pb.vec4();
  pb.main(function(){
    // Homogeneous space vertex position
    this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
    // Varying output variable
    this.$outputs.outColor = this.$inputs.color;
  });
},
fragment(pb){
  // Color output
  this.$outputs.color = pb.vec4();
  pb.main(function(){
    // The vertex output automatically becomes the fragment input
    this.$outputs.color = this.$inputs.outColor;
  });
}

```

## Operators

Since JavaScript does not support operator overloading, various mathematical operations must be performed by calling functions.

```javascript

vertex(pb){
  pb.main(function(){
    // x = 1.0
    this.x = pb.float(1);
    // y = 2.0
    this.y = pb.float(2);
    // z = (x + y) * 2.0;
    this.z = pb.mul(pb.add(this.x, this.y), 2);
  });
}

```

We support the following operators:

|operator|WebGL|WebGPU|
|--|--|--|
|Arithmetic operations|||
|```pb.add(this.a, this.b)```|```a + b```|```a + b```|
|```pb.sub(this.a, this.b)```|```a - b```|```a - b```|
|```pb.mul(this.a, this.b)```|```a * b```|```a * b```|
|```pb.div(this.a, this.b)```|```a / b```|```a / b```|
|```pb.compAnd(this.a, this.b)```|```a & b```|```a & b```|
|```pb.compXor(this.a, this.b)```|```a ^ b```|```a ^ b```|
|```pb.compOr(this.a, this.b)```|```a \| b```|```a \| b```|
|```pb.neg(this.a)```|```-a```|```-a```|
|```pb.sal(this.a, this.b)```|```a << b```|```a << b```|
|```pb.sar(this.a, this.b)```|```a >> b```|```a >> b```|
|Logical operations|||
|```pb.and(this.a, this.b)```|```a && b```|```a && b```|
|```pb.or(this.a, this.b)```|```a \|\| b```|```a \|\| b```|
|```pb.not(this.a)```|```!a```|```!a```|
|Relational operations|||
|```pb.equal(this.a, this.b)```|```a == b```|```all(a == b)```|
|```pb.notEqual(this.a, this.b)```|```a != b```|```any(a != b)```|
|```pb.lessThan(this.a, this.b)```|```lessThan(a, b)```|```a < b```|
|```pb.lessThanEqual(this.a, this.b)```|```lessThanEqual(a, b)```|```a <= b```|
|```pb.greaterThan(this.a, this.b)```|```greaterThan(a, b)```|```a > b```|
|```pb.greaterThanEqual(this.a, this.b)```|```greaterThanEqual(a, b)```|```a >= b```|
|```pb.compEqual(this.a, this.b)```|```equal(a, b)```|```a == b```|
|```pb.compNotEqual(this.a, this.b)```|```notEqual(a, b)```|```a != b```|

## Branching

The if branch is implemented by the [$if](/doc/markdown/./device.pbinsidefunctionscope._if) method of the scope, which takes a Boolean expression and a scope-generating function as parameters. The dollar sign is added before the method name to avoid confusion with scope variables.

```javascript

vertex(pb){
  this.x = pb.float(0);
  pb.main(function(){
    // if branch
    this.$if(pb.greaterThan(this.x, 0), function(){
      // if x > 0
    });
    // if-else
    this.$if(pb.greaterThan(this.x, 0), function(){
      // if x > 0
    }).$else(function(){
      // else
    });
    // if-elseif
    this.$if(pb.greaterThan(this.x, 0), function(){
      // if x >0
    }).$elseif(pb.equal(this.x, 0), function(){
      // else if x == 0
    }).$else(function(){
      // else
    });
  })
}

```

## Looping

We support simplified for loops, do-while loops (not supported on WebGL1 devices), and while loops (not supported on WebGL1 devices).

- FOR loop

The implementation is achieved through the scope's [$for](/doc/markdown/./device.pbinsidefunctionscope._for) method, which takes the loop variable, initial value, ending value, and a scope generation function as parameters. It only supports the pattern of for(loop variable = initial value; loop variable < ending value; loop variable++).

```for (TYPE VAR = START; VAR < END; VAR++)```


```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /* 
  Equivalent to the following GLSL
  for(int i = 1; i < x; i++) {
    y = y + i;
  }
  */
  this.$for(pb.int('i'), 1, this.x, function(){
    this.y = pb.add(this.y, this.i);
  });
});

```

- DO-WHILE loop

The do-while loop is implemented using [$do](/doc/markdown/./device.pbinsidefunctionscope._do) method.

```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /*
  Equivalent to the following GLSL
  do {
    y = y + x;
    x = x - 1;
  } while(x > 0);
  */
  this.$do(function(){
    // Loop body
    this.y = pb.add(this.y, this.x);
    this.x = pb.sub(this.x, 1);
  }).$while(pb.greaterThan(this.x, 0));
});

```

- WHILE loop

The while loop is implemented using [$while](/doc/markdown/./device.pbinsidefunctionscope._while) method, with a boolean expression as its parameter.

```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /*
  Equivalent to the following GLSL
  while (x > 0) {
    y = y + x;
    x = x - 1;
  }
  */
  this.$while(pb.greaterThan(this.x, 0), function(){
    // Loop body
    this.y = pb.add(this.y, this.x);
    this.x = pb.sub(this.x, 1);
  });
});

```

- Exit loop

You can exit the loop by calling [$break](/doc/markdown/./device.pbinsidefunctionscope._break) or [$continue](/doc/markdown/./device.pbinsidefunctionscope._continue) methods.

## Function

You can create functions using [pb.func](/doc/markdown/./device.programbuilder.func) method.

```javascript

vertex(pb){
  // Create a function called addTwoNumbers that takes two float arguments and returns their sum
  pb.func('addTwoNumbers', [pb.float('a'), pb.float('b')], function(){
    // $return method is used to return a value from the function
    this.$return(pb.add(this.a, this.b));
  });
  // Entry point
  pb.main(function(){
    this.x = pb.float(1);
    // Call the function we just defined
    this.y = this.addTwoNumbers(this.x, 2);
    // ... ...
  });
}

```

To create a function, you need to specify the function name and a list of named parameters. The return type is inferred from the function body, eliminating the need for explicit declaration. If a function with the same name is created, an overloaded version of the function will be automatically generated.

Function parameters can be input or output.

```javascript

vertex(pb){
  // Create a function that takes arguments of type two floats and swaps their values
  pb.func('swapTwoNumbers', [pb.float('a').inout(), pb.float('b').inout()], function(){
    this.$l.tmp = this.a;
    this.a = this.b;
    this.b = this.tmp;
  });
  // Entry point
  pb.main(function(){
    this.x = pb.float(1);
    this.y = pb.float(2):
    this.swapTwoNumbers(this.x, this.y);
    // ... ...
  });
}

```

## Builtin functions

We support almost all GLSL and WGSL built-in functions

```javascript

pb.func('foo', [pb.vec3('v')], function(){
  // Call the normalize built-in function
  this.$return(pb.normalize(this.v));
});

```

The following table contains the built-in functions that we support.

|Function|GLSL|WGSL|
|--|--|--|
|```pb.radians(this.x)```|```radians(x)```|```radians(x)```|
|```pb.degrees(this.x)```|```degrees(x)```|```degrees(x)```|
|```pb.sin(this.x)```|```sin(x)```|```sin(x)```|
|```pb.cos(this.x)```|```cos(x)```|```cos(x)```|
|```pb.tan(this.x)```|```tan(x)```|```tan(x)```|
|```pb.asin(this.x)```|```asin(x)```|```asin(x)```|
|```pb.acos(this.x)```|```acos(x)```|```acos(x)```|
|```pb.atan(this.x)```|```atan(x)```|```atan(x)```|
|```pb.atan2(this.x, this.y)```|```atan(x, y)```|```atan2(x, y)```|
|```pb.sinh(this.x)```|```sinh(x)```|```sinh(x)```|
|```pb.cosh(this.x)```|```cosh(x)```|```cosh(x)```|
|```pb.tanh(this.x)```|```tanh(x)```|```tanh(x)```|
|```pb.asinh(this.x)```|```asinh(x)```|```asinh(x)```|
|```pb.acosh(this.x)```|```acosh(x)```|```acosh(x)```|
|```pb.atanh(this.x)```|```atanh(x)```|```atanh(x)```|
|```pb.pow(this.x, this.y)```|```pow(x, y)```|```pow(x, y)```|
|```pb.exp(this.x)```|```exp(x)```|```exp(x)```|
|```pb.exp2(this.x)```|```exp2(x)```|```exp2(x)```|
|```pb.log(this.x)```|```log(x)```|```log(x)```|
|```pb.log2(this.x)```|```log2(x)```|```log2(x)```|
|```pb.sqrt(this.x)```|```sqrt(x)```|```sqrt(x)```|
|```pb.inverseSqrt(this.x)```|```inversesqrt(x)```|```inverseSqrt(x)```|
|```pb.abs(this.x)```|```abs(x)```|```abs(x)```|
|```pb.sign(this.x)```|```sign(x)```|```sign(x)```|
|```pb.floor(this.x)```|```floor(x)```|```floor(x)```|
|```pb.ceil(this.x)```|```ceil(x)```|```ceil(x)```|
|```pb.round(this.x)```|```sinh(x)```|```sinh(x)```|
|```pb.fract(this.x)```|```fract(x)```|```fract(x)```|
|```pb.mod(this.x)```|```mod(x)```|```mod(x)```|
|```pb.sinh(this.x)```|```sinh(x)```|```sinh(x)```|
|```pb.fma(this.x, this.y, this.z)```|```x * y + z```|```fma(x, y, z)```|
|```pb.min(this.x, this.y)```|```min(x, y)```|```min(x, y)```|
|```pb.max(this.x, this.y)```|```max(x, y)```|```max(x, y)```|
|```pb.clamp(this.x, this.y, this.z)```|```clamp(x, y, z)```|```clamp(x, y, z)```|
|```pb.mix(this.x, this.y, this.z)```|```mix(x, y, z)```|```mix(x, y, z)```|
|```pb.step(this.x, this.y)```|```step(x, y)```|```step(x, y)```|
|```pb.smoothStep(this.x, this.y, this.z)```|```smoothstep(x)```|```smoothstep(x)```|
|```pb.length(this.x)```|```length(x)```|```length(x)```|
|```pb.distance(this.x, this.y)```|```distance(x, y)```|```distance(x, y)```|
|```pb.dot(this.x, this.y)```|```dot(x, y)```|```dot(x, y)```|
|```pb.cross(this.x, this.y)```|```cross(x, y)```|```cross(x, y)```|
|```pb.normalize(this.x)```|```normalize(x)```|```normalize(x)```|
|```pb.faceForward(this.x, this.y, this.z)```|N/A|```faceForward(x, y, z)```|
|```pb.reflect(this.x, this.y)```|```reflect(x, y)```|```reflect(x, y)```|
|```pb.refract(this.x, this.y, this.z)```|```refract(x, y, z)```|```refract(x, y, z)```|
|```pb.frexp(this.x)```|N/A|```frexp(x)```|
|```pb.transpose(this.x)```|```transpose(x)```|```transpose(x)```|
|```pb.determinant(this.x)```|```determinant(x)```|```determinant(x)```|
|```pb.arrayLength(this.x)```|N/A|```arrayLength(x)```|
|```pb.select(this.x, this.y, this.z)```|N/A|```select(x, y, z)```|
|```pb.floatBitsToInt(this.x)```|```floatBitsToInt(x)```|N/A|
|```pb.floatBitsToUint(this.x)```|```floatBitsToUint(x)```|N/A|
|```pb.intBitsToFloat(this.x)```|```intBitsToFloat(x)```|N/A|
|```pb.uintBitsToFloat(this.x)```|```uintBitsToFloat(x)```|N/A|
|```pb.pack4x8snorm(this.x)```|N/A|```pack4x8snorm(x)```|
|```pb.unpack4x8snorm(this.x)```|N/A|```unpack4x8snorm(x)```|
|```pb.pack4x8unorm(this.x)```|N/A|```pack4x8unorm(x)```|
|```pb.unpack4x8unorm(this.x)```|N/A|```unpack4x8unorm(x)```|
|```pb.pack2x16snorm(this.x)```|N/A|```pack2x16snorm(x)```|
|```pb.unpack2x16snorm(this.x)```|N/A|```unpack2x16snorm(x)```|
|```pb.pack2x16unorm(this.x)```|N/A|```pack2x16unorm(x)```|
|```pb.unpack2x16unorm(this.x)```|N/A|```unpack2x16unorm(x)```|
|```pb.pack2x16float(this.x)```|N/A|```pack2x16float(x)```|
|```pb.unpack2x16float(this.x)```|N/A|```unpack2x16float(x)```|
|```pb.dpdx(this.x)```|```dFdx(x)```|```dpdx(x)```|
|```pb.dpdy(this.x)```|```dFdy(x)```|```dpdy(x)```|
|```pb.fwidth(this.x)```|```fwidth(x)```|```fwidth(x)```|
|```pb.dpdxCoarse(this.x)```|```dFdx(x)```|```dpdxCoarse(x)```|
|```pb.dpdxFine(this.x)```|```dFdx(x)```|```dpdxFine(x)```|
|```pb.dpdyCoarse(this.x)```|```dFdy(x)```|```dpdyCoarse(x)```|
|```pb.dpdyFine(this.x)```|```dFdy(x)```|```dpdyFine(x)```|
|```pb.round(this.x)```|N/A|```round(x)```|
|```pb.trunc(this.x)```|N/A|```trunc(x)```|
|```pb.textureDimensions(this.tex, this.level)```|```textureSize(tex, level)```|```textureDimensions(tex, level)```|
|```pb.textureGather(this.tex, this.sampler, this.coord)```|N/A|```textureGater(tex, sampler, coord)```|
|```pb.textureGather(this.comp, this.tex, this.sampler, this.coord)```|N/A|```textureGater(comp, tex, sampler, coord)```|
|```pb.textureArrayGather(this.tex, this.sampler, this.coord, this.arrayIndex)```|N/A|```textureGater(tex, sampler, coord, arrayIndex)```|
|```pb.textureArrayGather(this.comp, this.tex, this.sampler, this.coord, this.arrayIndex)```|N/A|```textureGater(comp, tex, sampler, coord, arrayIndex)```|
|```pb.textureGatherCompare(this.x, this.sampler, this.coord, this.depthRef)```|N/A|```textureGaterCompare(x, sampler, coord, depthRef)```|
|```pb.textureArrayGatherCompare(this.x, this.sampler, this.coord, this.arrayIndex, this.depthRef)```|N/A|```textureGaterCompare(x, sampler, coord, arrayIndexdepthRef)```|
|```pb.textureLoad(this.tex, this.coord, this.level)```|```texelFetch(tex, coord, level)```|```textureLoad(tex, coord, level)```|
|```pb.textureArrayLoad(this.tex, this.coord, this.arrayIndex, this.level)```|```texelFetch(tex, coord, level)```|```textureLoad(tex, coord, arrayIndex, level)```|
|```pb.textureStore(this.tex, this.coord, this.value)```|N/A|```textureStore(tex, coord, value)```|
|```pb.textureArrayStore(this.tex, this.coord, this.arrayIndex, this.value)```|N/A|```textureStore(tex, coord, arrayIndex, value)```|
|```pb.textureLoad(this.tex, this.coord, this.level)```|```texelFetch(tex, coord, level)```|```textureLoad(tex, coord, level)```|
|```pb.textureNumLayers(this.tex)```|N/A|```textureNumLayers(tex)```|
|```pb.textureNumLevels(this.tex)```|N/A|```textureNumLevels(tex)```|
|```pb.textureNumSamples(this.tex)```|N/A|```textureNumSamples(tex)```|
|```pb.textureSample(this.tex, this.coord)```|```texture(tex, coord)```|```textureSample(tex, coord)```|
|```pb.textureArraySample(this.tex, this.coord, this.arrayIndex)```|```texture(tex, coord)```|```textureSample(tex, coord, arrayIndex)```|
|```pb.textureSampleBias(this.tex, this.coord, this.bias)```|```texture(tex, coord, bias)```|```textureSampleBias(tex, coord, bias)```|
|```pb.textureArraySampleBias(this.tex, this.coord, this.arrayIndex, this.bias)```|```texture(tex, coord, bias)```|```textureSampleBias(tex, coord, arrayIndex, bias)```|
|```pb.textureSampleCompare(this.tex, this.coord, this.depthRef)```|```texture(tex, coord)```|```textureSampleCompare(tex, coord, depthRef)```|
|```pb.textureArraySampleCompare(this.tex, this.coord, this.arrayIndex, this.depthRef)```|```texture(tex, coord)```|```textureSampleCompare(tex, coord, this.arrayIndex, depthRef)```|
|```pb.textureSampleLevel(this.tex, this.coord, this.level)```|```textureLod(tex, coord, level)```|```textureSampleLevel(tex, coord, level)```|
|```pb.textureArraySampleLevel(this.tex, this.coord, this.arrayIndex, this.level)```|```textureLod(tex, coord, level)```|```textureSampleLevel(tex, coord, arrayIndex, level)```|
|```pb.textureSampleCompareLevel(this.tex, this.coord, this.depthRef)```|```texture(tex, coord)```|```textureSampleCompareLevel(tex, coord, depthRef)```|
|```pb.textureArraySampleCompareLevel(this.tex, this.coord, this.arrayIndex, this.depthRef)```|```texture(tex, coord)```|```textureSampleCompareLevel(tex, coord, arrayIndex, depthRef)```|
|```pb.textureSampleGrad(this.tex, this.coord, this.ddx, this.ddy)```|```textureGrad(tex, coord, ddx, ddy)```|```textureSampleGrad(tex, coord, ddx, ddy)```|
|```pb.textureArraySampleGrad(this.tex, this.coord, this.arrayIndex, this.ddx, this.ddy)```|```textureGrad(tex, coord, ddx, ddy)```|```textureSampleGrad(tex, coord, arrayIndex, ddx, ddy)```|
|```pb.storageBarrier()```|N/A|```storageBarrier()```|
|```pb.workgroupBarrier()```|N/A|```workgroupBarrier()```|
|```pb.atomicLoad(this.ptr)```|N/A|```atomicLoad(ptr)```|
|```pb.atomicStore(this.ptr, this.value)```|N/A|```atomicStore(ptr, value)```|
|```pb.atomicAdd(this.ptr, this.value)```|N/A|```atomicAdd(ptr, value)```|
|```pb.atomicSub(this.ptr, this.value)```|N/A|```atomicSub(ptr, value)```|
|```pb.atomicMax(this.ptr, this.value)```|N/A|```atomicMax(ptr, value)```|
|```pb.atomicMin(this.ptr, this.value)```|N/A|```atomicMin(ptr, value)```|
|```pb.atomicAnd(this.ptr, this.value)```|N/A|```atomicAnd(ptr, value)```|
|```pb.atomicOr(this.ptr, this.value)```|N/A|```atomicOr(ptr, value)```|
|```pb.atomicXor(this.ptr, this.value)```|N/A|```atomicXor(ptr, value)```|

## Uniform

Uniform variables needs to be defined in the global scope as follows:

```javascript

vertex(pb){
  // Vertex inputs
  this.$inputs.pos = pb.vec3().attrib('position');
  this.$inputs.color = pb.vec4().attrib('diffuse');
  // Varying outputs
  this.$outputs.outColor = pb.vec4();
  // Defines an uniform
  this.mvpMatrix = pb.mat4().uniform(0);
  pb.main(function(){
    // Transforms position into homogeneous space
    this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
    // Varying output
    this.$outputs.outColor = this.$inputs.color;
  });
},
fragment(pb){
  // color output
  this.$outputs.color = pb.vec4();
  pb.main(function(){
    this.$outputs.color = this.$inputs.outColor;
  });
}

```

To use a variable as a uniform, you must invoke the [uniform()](/doc/markdown/./device.pbshaderexp.uniform) method to declare that the variable is a uniform. The method requires the number of the BindGroup to which the uniform belongs as its parameter. The concept of a BindGroup here aligns with the BindGroup concept in the WebGPU standard. Just like referencing global variables, uniform variables can be referenced in the same manner; however, they cannot be assigned new values. In both WebGL2 and WebGPU, all uniform constants are packaged into a UniformBuffer, although it's also possible to declare a UniformBuffer independently.


```javascript

vertex(pb){
  // 60 vec4 elements in a single uniform buffer
  this.values = pb.vec4[60]().uniformBuffer(0);
}

```

## Bind Group

After a Shader is created, it requires setting Uniform constants to be used for rendering. We follow the WebGPU specification to pass parameters to the Shader through resource binding groups.

```javascript

const program = device.buildRenderProgram({
  vertex(pb) {
    this.$inputs.pos = pb.vec3().attrib('position');
    this.$inputs.uv = pb.vec2().attrib('texCoord0');
    this.mvpMatrix = pb.mat4().uniform(0);
    pb.main(function(){
      this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
      this.$outputs.outUV = this.$inputs.uv;
    });
  },
  fragment(pb) {
    this.$outputs.color = pb.vec4();
    this.tex = pb.tex2D().uniform(1);
    this.factor = pb.vec4().uniform(1);
    pb.main(function(){
      this.sampleColor = pb.textureSample(this.tex, this.$inputs.outUV);
      this.$outputs.color = pb.mul(this.sampleColor, this.factor);
    });
  }
});

```

The shader mentioned above requires three uniform constants: mvpMatrix, which belongs to binding group 0, and tex and factor, which are part of binding group 1. To pass parameters, we need to create these two binding groups.

```javascript

// Create a binding group with the binding group layout descriptor at index 0
const bindgroup0 = device.createBindGroup(program.bindGroupLayouts[0]);
// Set uniform values
const mvpMatrix = new Matrix4x4();
bindgroup0.setValue('mvpMatrix', mvpMatrix);

// Create a binding group with the binding group layout descriptor at index 1
const bindgroup1 = device.createBindGroup(program.bindGroupLayouts[1]);
// Set uniform values
bindgroup1.setValue('factor', new Vector4(1, 1, 1, 1));
bindgroup1.setTexture('tex', texture);

```

When rendering, it's necessary to set the device's current Shader and the related binding groups.

```javascript

// Set current shader
device.setProgram(program);
// Set bind groups
device.setBindGroup(0, bindgroup0);
device.setBindGroup(1, bindgroup1);
// Draw call

```

## Compute Shader

Compute Shaders are primarily utilized for executing a vast number of parallel computations on the GPU and are available on WebGPU devices. The [Device.buildComputeProgram()](/doc/markdown/./device.abstractdevice.buildcomputeprogram) method can be used to create a Compute Shader.

```javascript

const computeProgram = device.buildComputeProgram({
  // Specify how many compute cores, or threads, need to be applied for in the three dimensions
  workgroupSize: [64, 1, 1],
  compute(pb) {
    // Storage buffer for reading
    this.readbuffer = pb.vec4[0]().storageBuffer(0);
    // Storage buffer for writing
    this.writebuffer = pb.vec4[0]().storageBuffer(0);
    pb.main(function(){
      // current index
      this.index = this.$builtins.globalInvocationId.x;
      // Write value
      this.writebuffer.setAt(this.index, this.readbuffer.at(this.index));
    });
  }
});

```
