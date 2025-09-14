# 间接光照

在场景里我们只支持一个环境光，环境光通过```scene.env.light```进行设置。```scene.env.light.type```属性用来定义环境光的类型。
目前该属性可以取值'ibl','hemisphere','none'，默认值是'ibl'，如果取值'none'则会关闭环境光照。

以下我们依次介绍三种环境光类型。

## IBL(基于图像的间接光照)

IBL是通过对环境贴图在球面空间进行积分而预先计算出场景中每个点的环境光照。IBL适用于PBR材质。

要使用IBL环境光，需要将scene.env.light.type设置为"ibl"，并且需要设置预计算好的两张贴图：辐射率贴图(Radiance Map)和辐照度贴图(Irradiance Map)。
如果未设置该贴图，则系统会通过当前天空动态生成该贴图，如果无天空，则不会渲染任何环境光照。

辐射率贴图和辐照度贴图通常使用类似CMFT这样的工具生成，我们也提供了动态生成该帖图的功能。在下面的代码中，我们通过一张高动态范围的360度全景图生成辐射率贴图
和辐照度贴图并生成一张立方体天空贴图。

```javascript

  // 加载全景图
  assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr').then(tex => {
    // 通过全景图生成立方体天空贴图
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
    panoramaToCubemap(tex, skyMap);
    // 通过立方体天空贴图生成辐射率贴图
    const radianceMap = myApp.device.createCubeTexture('rgba16f', 256);
    prefilterCubemap(skyMap, 'ggx', radianceMap);
    // 通过立方体天空贴图生成辐照度贴图
    const irradianceMap = myApp.device.createCubeTexture('rgba16f', 64);
    prefilterCubemap(skyMap, 'lambertian', irradianceMap);
    // 设置天空模式为天空盒并设置天空盒贴图
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;
    // 设置环境光照模式为IBL并设置辐射率贴图和辐照度贴图
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = radianceMap;
    scene.env.light.irradianceMap = irradianceMap;
  });

```

<div class="showcase" case="tut-14" style="width:600px;height:800px;"></div>

## HemisphericLight(半球形天光)

半球形天光是对环境光的一种简单模拟。我们为天空和地面分别指定一种颜色，物体受到的环境光通过对天空颜色和地面颜色根据法线朝向进行插值获得。

```javascript

// Hemisphere环境光
scene.env.light.type = 'hemisphere';
scene.env.light.ambientUp = new Vector4(0.3, 0.6, 1.0, 1.0);
scene.env.light.ambientDown = new Vector4(0.2, 0.2, 0.2);

```

<div class="showcase" case="tut-15" style="width:600px;height:800px;"></div>

