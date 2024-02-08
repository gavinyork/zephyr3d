# 地形

地形是渲染户外场景的一个重要功能，目前我们有一个基于ChunkedLOD算法的地形实现，支持渲染固定大小的地形。

目前的地形实现有以下限制

1. 地形分辨率限制为（2^N+1)x(2^N+1)。
2. 不支持动态加载，不适合渲染无限地形或超大地形，推荐地图分辨率不超过1025x1025。
3. 最多支持4级细节纹理。

渲染地形需要以下数据：

1. 高度图数据(HeightMap)，存储地形范围内每个坐标的高度，通常由地形创作工具导出为灰度图像或原始数据。
2. 地形表面法线(NormalMap)，该数据在导入高度图的时候系统会自行计算，无需提供。
3. 地表细节纹理(DetailMap)。我们目前支持最多4层细节纹理及对应的法线贴图，每层细节纹理可单独设置平铺大小。我们使用PBR渲染地形，每层细节纹理可单独设置金属度和粗糙度。
4. 权重纹理(SplatMap)。权重纹理的RGBA四个通道分别存储每层细节纹理的权重，通常由地形创作工具导出。

植被：

目前我们支持根据细节纹理权重分布草地植被，只需要提供草纹理，分布密度，公告板大小就可以自行生成草地网格。


```javascript

// 地形分辨率，必须为2的N次方加一
const TERRAIN_WIDTH = 257;
const TERRAIN_HEIGHT = 257;
// 地形的最大高度，该数据通常由地形创作工具导出
const maxHeight = 62;
// 载入高度图，raw文件内保存了经过归一化的16位整形高度值
const arrayBuffer = await assetManager.fetchBinaryData('assets/map/heightmap.raw');
const heightsInt16 = new Uint16Array(arrayBuffer);
// 16位整型高度值转换为0到1区间的浮点值
const heightmap = new Float32Array(TERRAIN_WIDTH * TERRAIN_HEIGHT);
for (let i = 0; i < TERRAIN_WIDTH * TERRAIN_HEIGHT; i++) {
  heightmap = heightsInt16[i] / 65535;
}
// 载入SplatMap，
const splatMap = await assetManager.fetchTexture('assets/maps/map1/splatmap.tga', { linearColorSpace: true });
// 细节纹理1
const detailAlbedo0 = await assetManager.fetchTexture('assets/maps/map1/detail1.jpg', { linearColorSpace: false });
const detailNormal0 = await assetManager.fetchTexture('assets/maps/map1/detail1_norm.jpg', { linearColorSpace: true });
// 细节纹理2
const detailAlbedo1 = await assetManager.fetchTexture('assets/maps/map1/detail2.jpg', { linearColorSpace: false });
const detailNormal1 = await assetManager.fetchTexture('assets/maps/map1/detail2_norm.jpg', { linearColorSpace: true });
// 细节纹理3
const detailAlbedo2 = await assetManager.fetchTexture('assets/maps/map1/detail3.jpg', { linearColorSpace: false });
const detailNormal2 = await assetManager.fetchTexture('assets/maps/map1/detail3_norm.jpg', { linearColorSpace: true });
// 草贴图
const grass1 = await assetManager.fetchTexture('assets/images/grass1.dds');
const grass2 = await assetManager.fetchTexture('assets/images/grass2.dds');

// 创建地形
const terrain = new Terrain(scene);
// 使用高度图初始化地形
// 参数1，2：地形分辨率
// 参数3: 高度数据
// 参数4：地形的XYZ轴缩放。如果需要缩放地形，使用这个参数。如果使用节点的缩放变换会导致地形法线和地形LOD计算错误。
// 参数5：每个patch的分辨率，也必须为2的N次方加一。该值越大，LOD作用越小导致更多的顶点数量，但会大大减少DrawCall。
// 参数6：细节纹理设置
terrain.create(TERRAIN_WIDTH, TERRAIN_HEIGHT, heightmap, new Vector3(1, maxHeight, 1), 33, {
  // 权重图
  splatMap: splatMap,
  // 细节纹理
  detailMaps: {
    // 细节颜色贴图列表，不超过4个
    albedoTextures: [detailAlbedo0, detailAlbedo1, detailAlbedo2],
    // 细节法线贴图列表，不超过4个
    normalTextures: [detailNormal0, detailNormal1, detailNormal2],
    // 每个细节纹理的平铺参数，值越大越密
    uvScale: [30, 30, 30],
    // 每个细节法线纹理的法线缩放，值越小法线越平坦
    normalScale: [0.5, 0.5, 0.5],
    // 每个细节纹理的金属度，如不传，默认均为0
    metallic: [0, 0, 0],
    // 每个细节纹理的粗糙度，如不传，默认均为1
    roughness: [0.95, 0.9, 0.7],
    // 在第一层细节纹理分布两层草地
    grass: [[{
      // Billboard宽度
      bladeWidth: 2,
      // Billboard高度
      bladeHeigh: 2,
      // 密度，每单位面积分布1.5束
      density: 1.5,
      offset: -0.1,
      texture: grass1
    }, {
      bladeWidth: 2,
      bladeHeigh: 3,
      density: 0.1,
      offset: -0.02,
      texture: grass2
    }]]
  }
});

```

地形是由高度图构成，我们可以获取地形内任意一点的高度。

下面的代码演示如何通过获取地形高度将摄像机的最低位置限制在地表以上

```javascript

// 每一帧修正摄像机位置
myApp.on('tick', ev => {
  camera.updateController();
  // 获取相机在世界坐标系的位置
  const cameraPos = camera.getWorldPosition();
  // 相机位置转换到地形空间
  const terrainSpacePos = terrain.worldToThis(cameraPos);
  // 根据x坐标和z坐标获取该点的高度值
  const height = terrain.getElevation(terrainSpacePos.x, terrainSpacePos.z);
  // 限制摄像机高度不低于地形表面向上3个单位
  if (terrainSpacePos.y < height + 3) {
    terrainSpacePos.y = height + 3;
    // 位置重新换算到摄像机的父空间
    camera.position = terrain.thisToOther(camera.parent, terrainSpacePos);
  }
  camera.render(scene);
});

```

以上功能还有更简单的实现，那就是让摄像机成为地形的子节点，这样摄像机的位置就在地形空间内无需再做转换

```javascript

// 设置camera为地形的子节点
camera.parent = terrain

myApp.on('tick', ev => {
  camera.updateController();

  // 摄像机位置处于地形坐标系内，可以直接用来获取高度
  const height = terrain.getElevation(camera.position.x, camera.position.z);
  // 修正摄像机坐标
  if (camera.position.y < height + 3) {
    camera.position.y = height + 3;
  }
  camera.render(scene, compositor);
});

```

以下示例演示渲染一个257x257的小地形，使用三层细节纹理。

示例采用FPS摄像机控制器，需要使用WSAD键和鼠标键游玩。空格键切换网格显示。

<div class="showcase" case="tut-31"></div>

