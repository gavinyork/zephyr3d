# 编写Shader

出于跨图形API的需要，我们使用原生javascript根据设备类型动态生成GLSL或WGSL代码，

下面是一个生成Shader的示例：

```javascript

// 通过js创建ShaderProgram
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

// 生成的VertexShader代码
console.log(program.getShaderSource('vertex'));
// 生成的FragmentShader代码
console.log(program.getShaderSource('fragment'));

```

我们调用[device.buildRenderProgram()](/doc/markdown/./device.abstractdevice.buildrenderprogram)方法来创建渲染用的Shader。参数中的vertex()和fragment()分别是VertexShader和FragmentShader的生成函数。

两个生成函数接受的参数pb(ProgramBuilder)是生成Shader的主要接口对象，提供了Shader中的数据类型定义，流程控制以及Shader内置变量和函数的定义。生成函数不可以是箭头函数，他们的隐含this都指向Shader的全局作用域。

## 作用域

在Shader生成函数中，作用域意义与Shader代码中的作用域相似，在作用域中可以定义常量，变量，全局作用域中可以定义Shader的输入输出以及Uniform常量，函数作用域中可以执行分支循环，分支循环也是通过生成函数来实现，也具有自己的作用域。在作用域中访问变量或常量，将会沿着作用域链向上查找。

## 入口函数

全局作用域调用[pb.main()](/doc/markdown/./device.programbuilder.main)来创建Shader的入口函数，参数是一个生成函数(this指向作用域的函数)。

```javascript

const program = device.buildRenderProgram({
  vertex(pb){
    // 这里的this指向全局作用域
    pb.main(function(){
      // 这里的this指向函数作用域
      // VertexShader入口函数代码
    });
  },
  fragment(pb){
    pb.main(function(){
      // FragmentShader入口函数代码
    });
  }
});

```

## 定义变量


全局作用域可以定义全局变量，其他作用域可以定义块内的局部变量。

```javascript

vertex(pb) {
  // 声明vec4类型全局变量
  this.x = pb.vec4();
  // 声明并初始化全局变量
  this.y = pb.vec4(1, 2, 3, 4);
}

```

以上代码生成GLSL:

```
vec4 x;
vec4 y = vec4(1.0,2.0,3.0,4.0);
```

以上代码生成WGSL:

```
var<private> x: vec4<f32>;
var<private> y: vec4<f32> = vec4<f32>(1.0,2.0,3.0,4.0);
```

下面的代码定义函数作用域的局部变量

```javascript

vertex(pb) {
  pb.main(function(){
    // 隐含this为入口函数作用域
    this.x = pb.vec4(1);
  });
}

```

如果在局部作用域的父作用域内有相同名称的变量，则该语句变为对父级作用域同名变量的赋值，如下例：

```javascript

vertex(pb) {  
  this.x = pb.vec4();
  pb.main(function(){
    // 父级作用域已存在变量x，以下则为赋值语句
    this.x = pb.vec4(1);
  });
}

```

生成GLSL如下:

```
vec4 a;
void main() {
  a = vec4(1.0);
}
```

如果我们的确需要声明局部变量，不管父级作用域是否有相同名称变量，则需要显示指定作用域为当前作用域，如下例：

```javascript

vertex(pb) {  
  this.x = pb.vec4();
  pb.main(function(){
    // 作用域调用$l获取当前作用域，这里是在当前作用域定义变量x，即使父级作用域存在x变量
    this.$l.x = pb.vec4(1);
    // 这时当前作用域已存在变量x，这里成为赋值
    this.$l.x = pb.vec4(2);
  });
}

```

生成GLSL如下:

```
vec4 a;
void main() {
  vec4 a = vec4(1.0);
  a = vec4(2.0);
}
```


我们支持以下Shader数据类型

|类型|构造函数|WebGL/WebGL2|WebGPU|
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

对于非纹理贴图类型的变量，我们也可以定义数组类型：

```javascript

vertex(pb){
  // 定义长度为2的vec4数组
  this.x = pb.vec4[2]();
  // 定义并初始化（WebGL1设备不支持)
  this.y = pb.vec4[2](pb.vec4(1), pb.vec4(2));
}

```

以上代码生成GLSL:

```
vec4 x[2];
vec4 y[2] = vec4[2](vec4(1.0),vec4(2.0));
```

以上代码生成WGSL:

```
var<private> x: array<vec4<f32>, 2>;
var<private> y: array<vec4<f32>, 2> = array<vec4<f32>, 2>(vec4<f32>(1.0),vec4<f32>(2.0));
```

二维数组和不定长数组类型仅支持WebGPU设备：

```javascript

// 定义vec4的二维数组
this.x = pb.vec4[2][2]();

// 定义不定长数组
this.y = pb.vec4[0]();

```

以上代码生成WGSL:

```
var<private> a: array<array<vec4<f32>, 2>, 2>;
```

我们也支持结构类型，首先需要用[pb.defineStruct()](/doc/markdown/./device.programbuilder.definestruct)函数定义结构的构造器，然后使用该构造器来构造实例：

```javascript

vertex(pb){
  // 定义一个结构，该结构包含两个成员，{ vec4 a, vec3 b }
  const MyStruct = pb.defineStruct([pb.vec4('a'), pb.vec3('b')]);
  pb.main(function(){
    // 实例化结构体
    this.k = MyStruct();
    // 结构体成员赋值
    this.k.a = pb.vec4(1);
    this.k.b.x = 0;
    this.k.b.y = 1;
    this.k.b.z = 2;
    // 构造并初始化结构体
    this.t = MyStruct(pb.vec4(1), pb.vec3(2));
  });
}

```

## 预定义变量作用域

预定义变量作用域包含了Shader里预定义的所有变量，无需声明，可直接使用。

```javascript

vertex(pb){
  // 通过$builtins属性获取预定义变量作用域，vertexIndex对应于GLSL里的gl_VertexID或WGSL里的@builtin(vertex_index)
  this.$l.vertexId = this.$builtins.vertexIndex;
},

```

下表包含了我们目前支持的所有内置变量

|内置变量|WebGL|WebGL2|WGSL|Stage|
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

## 输入输出作用域

输入输出是两种特殊的作用域，对于VertexShader，输入作用域里只包含顶点输入，输出作用域包含由VertexShader传递给FragmentShader的Varying变量，对于FragmentShader，输入作用域自动由VertexShader的输出作用域生成，无需手动声明，输出作用域只包含FragmentShader的颜色输出。

```javascript

vertex(pb){
  // VertexShader的输入作用域内定义顶点流，顶点流必需调用attrib()方法指明顶点用途。
  this.$inputs.pos = pb.vec3().attrib('position');
  this.$inputs.color = pb.vec4().attrib('diffuse');
  // 定义Varying输出变量
  this.$outputs.outColor = pb.vec4();
  pb.main(function(){
    // 齐次空间顶点位置
    this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
    // Varying输出变量
    this.$outputs.outColor = this.$inputs.color;
  });
},
fragment(pb){
  // 颜色输出
  this.$outputs.color = pb.vec4();
  pb.main(function(){
    // vertex输出自动成为fragment输入
    this.$outputs.color = this.$inputs.outColor;
  });
}

```

## 运算符

因为javascript不支持运算符重载，各种数学运算需要调用函数完成, 例如：

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

我们支持以下运算符：

|运算符|WebGL|WebGPU|
|--|--|--|
|数学运算|||
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
|逻辑运算|||
|```pb.and(this.a, this.b)```|```a && b```|```a && b```|
|```pb.or(this.a, this.b)```|```a \|\| b```|```a \|\| b```|
|```pb.not(this.a)```|```!a```|```!a```|
|关系运算|||
|```pb.equal(this.a, this.b)```|```a == b```|```all(a == b)```|
|```pb.notEqual(this.a, this.b)```|```a != b```|```any(a != b)```|
|```pb.lessThan(this.a, this.b)```|```lessThan(a, b)```|```a < b```|
|```pb.lessThanEqual(this.a, this.b)```|```lessThanEqual(a, b)```|```a <= b```|
|```pb.greaterThan(this.a, this.b)```|```greaterThan(a, b)```|```a > b```|
|```pb.greaterThanEqual(this.a, this.b)```|```greaterThanEqual(a, b)```|```a >= b```|
|```pb.compEqual(this.a, this.b)```|```equal(a, b)```|```a == b```|
|```pb.compNotEqual(this.a, this.b)```|```notEqual(a, b)```|```a != b```|

## 分支

if分支通过作用域的[$if](/doc/markdown/./device.pbinsidefunctionscope._if)方法实现，参数为布尔表达式和作用域生成函数。
方法名前加上$符号是为了避免和作用域变量混淆。

```javascript

vertex(pb){
  this.x = pb.float(0);
  pb.main(function(){
    // if语句
    this.$if(pb.greaterThan(this.x, 0), function(){
      // 如果x>0
    });
    // if-else语句
    this.$if(pb.greaterThan(this.x, 0), function(){
      // 如果x>0
    }).$else(function(){
      // 否则
    });
    // if-elseif语句
    this.$if(pb.greaterThan(this.x, 0), function(){
      // 如果x>0
    }).$elseif(pb.equal(this.x, 0), function(){
      // 否则如果x==0
    }).$else(function(){
      // 否则
    });
  })
}

```

## 循环

我们支持简化的for循环，do-while循环(不支持WebGL1设备)，while循环(不支持WebGL1设备)

- for循环

通过作用域的[$for](/doc/markdown/./device.pbinsidefunctionscope._for)方法实现，参数为循环变量，起始值，结束值和作用域生成函数构成，仅支持for(循环变量 = 初始值; 循环变量 < 结束值; 循环变量++)这种模式。

```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /* 
  相当于以下GLSL
  for(int i = 1; i < x; i++) {
    y = y + i;
  }
  */
  this.$for(pb.int('i'), 1, this.x, function(){
    this.y = pb.add(this.y, this.i);
  });
});

```

- do-while循环

do-while循环通过作用域的[$do](/doc/markdown/./device.pbinsidefunctionscope._do)方法实现。

```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /*
  相当于以下GLSL
  do {
    y = y + x;
    x = x - 1;
  } while(x > 0);
  */
  this.$do(function(){
    // 循环体
    this.y = pb.add(this.y, this.x);
    this.x = pb.sub(this.x, 1);
  }).$while(pb.greaterThan(this.x, 0));
});

```

- while循环

while循环通过作用域的[$while](/doc/markdown/./device.pbinsidefunctionscope._while)方法实现，参数为布尔表达式。

```javascript

pb.main(function(){
  this.x = pb.int(10);
  this.y = pb.int(0);
  /*
  相当于以下GLSL
  while (x > 0) {
    y = y + x;
    x = x - 1;
  }
  */
  this.$while(pb.greaterThan(this.x, 0), function(){
    // 循环体
    this.y = pb.add(this.y, this.x);
    this.x = pb.sub(this.x, 1);
  });
});

```

- 退出循环

在循环体内可以通过调用作用域的[$break](/doc/markdown/./device.pbinsidefunctionscope._break)或[$continue](/doc/markdown/./device.pbinsidefunctionscope._continue)方法来退出循环。

## 函数

可以使用[pb.func](/doc/markdown/./device.programbuilder.func)方法来创建函数。

```javascript

vertex(pb){
  // 创建名叫addTwoNumbers的函数，接受两个float类型的参数，返回它们的和
  pb.func('addTwoNumbers', [pb.float('a'), pb.float('b')], function(){
    // $return方法用于从函数中返回值，void函数中不调用$return
    this.$return(pb.add(this.a, this.b));
  });
  // 入口函数
  pb.main(function(){
    this.x = pb.float(1);
    // 调用刚才定义的函数
    this.y = this.addTwoNumbers(this.x, 2);
    // ... ...
  });
}

```

创建函数需要给定函数名称和命名的参数列表，返回值类型会根据函数体自行推断，无需指定。如果创建相同名称的函数会自行生成重载函数。

如果需要输出到函数参数，需要参数内加以指明：

```javascript

vertex(pb){
  // 创建函数，接受两个float类型的参数，并交换它们的值，这两个参数需要指明为输入输出
  pb.func('swapTwoNumbers', [pb.float('a').inout(), pb.float('b').inout()], function(){
    this.$l.tmp = this.a;
    this.a = this.b;
    this.b = this.tmp;
  });
  // 入口函数
  pb.main(function(){
    this.x = pb.float(1);
    this.y = pb.float(2):
    this.swapTwoNumbers(this.x, this.y);
    // ... ...
  });
}

```

## 内置函数

我们支持几乎所有GLSL和WGSL内置的函数

```javascript

pb.func('foo', [pb.vec3('v')], function(){
  // 调用normalize内置函数
  this.$return(pb.normalize(this.v));
});

```

下表包含了我们支持的内置函数

|内置函数|GLSL|WGSL|
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

Uniform常量需要在全局作用域定义，方法如下：

```javascript

vertex(pb){
  // 顶点输入
  this.$inputs.pos = pb.vec3().attrib('position');
  this.$inputs.color = pb.vec4().attrib('diffuse');
  // Varying输出
  this.$outputs.outColor = pb.vec4();
  // 定义uniform
  this.mvpMatrix = pb.mat4().uniform(0);
  pb.main(function(){
    // 坐标变换到齐次空间
    this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
    // Varying输出变量
    this.$outputs.outColor = this.$inputs.color;
  });
},
fragment(pb){
  // 颜色输出
  this.$outputs.color = pb.vec4();
  pb.main(function(){
    // vertex输出自动成为fragment输入
    this.$outputs.color = this.$inputs.outColor;
  });
}

```

作为uniform的变量需要调用[uniform()](/doc/markdown/./device.pbshaderexp.uniform)方法表明该变量是一个uniform，方法的参数是该uniform所属的绑定组(BindGroup)的序号。

这里绑定组的概念和WebGPU标准里的BindGroup概念相同。

引用uniform变量和引用全局变量方法一样，但是uniform变量不可赋值。

对于WebGL2和WebGPU，所有uniform常量会被打包到一个UniformBuffer中，你也可以单独声明一个UniformBuffer。

```javascript

vertex(pb){
  // 60个vec4元素在一个单独的uniformbuffer中
  this.values = pb.vec4[60]().uniformBuffer(0);
}

```

## 绑定组

当Shader创建以后，需要设置Uniform常量方可用于渲染。我们遵循WebGPU规范采用资源绑定组向Shader传递参数。

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

以上Shader需要三个uniform常量，其中mvpMatrix属于0号绑定组，tex和factor属于1号绑定组，为了传递参数，我们需要创建这两个绑定组：

```javascript

// 通过0号绑定组布局描述符创建绑定组
const bindgroup0 = device.createBindGroup(program.bindGroupLayouts[0]);
// 传递参数
const mvpMatrix = new Matrix4x4();
// 设置uniform
bindgroup0.setValue('mvpMatrix', mvpMatrix);

// 通过1号绑定组布局描述符创建绑定组
const bindgroup1 = device.createBindGroup(program.bindGroupLayouts[1]);
// 设置uniform
bindgroup1.setValue('factor', new Vector4(1, 1, 1, 1));
bindgroup1.setTexture('tex', texture);

```

渲染时需要设置设备的当前Shader以及相关的绑定组

```javascript

// 设置当前Shader
device.setProgram(program);
device.setBindGroup(0, bindgroup0);
device.setBindGroup(1, bindgroup1);
// 调用渲染命令

```

## 计算Shader

计算Shader(Compute Shader)主要用于在GPU上运行大量的并行运算，在WebGPU设备上可用。

可以使用[Device.buildComputeProgram()](/doc/markdown/./device.abstractdevice.buildcomputeprogram)方法来创建计算Shader。

```javascript

const computeProgram = device.buildComputeProgram({
  // 指定在三个维度上需要申请多少计算核心或者说线程数
  workgroupSize: [64, 1, 1],
  compute(pb) {
    // 用于读取的StorageBuffer
    this.readbuffer = pb.vec4[0]().storageBuffer(0);
    // 用于写入的StorageBuffer
    this.writebuffer = pb.vec4[0]().storageBuffer(0);
    pb.main(function(){
      // 当前处理元素索引
      this.index = this.$builtins.globalInvocationId.x;
      // 赋值
      this.writebuffer.setAt(this.index, this.readbuffer.at(this.index));
    });
  }
});

```
