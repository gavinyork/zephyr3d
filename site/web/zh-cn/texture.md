# 纹理

## 创建纹理

设备提供了多种创建纹理的方法

```javascript

// 给定像素格式和宽高，创建2D纹理
const texture = device.createTexture2D('rgba8unorm', 256, 256);

// 给定像素格式和宽高，创建2D纹理并指定采样设置
const texture = device.createTexture2D('rgba8unorm', 256, 256, {
  // 如果为true，不包含mipmap，默认为false
  noMipmap: true,
  // 采样设置
  samplerOptions: {
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'none',
    addressU: 'repeat',
    addressV: 'repeat'
  }
});

// 给定像素格式和宽高，创建可写入的2D纹理(仅WebGPU)
const texture = device.createTexture2D('rgba8unorm', 256, 256, {
  noMipmap: true,
  writable: true
});

// 通过Image创建2D纹理
const img = document.createElement('img');
img.src = IMAGE_URL;
img.onLoad = function(){
  createImageBitmap(img, { premultiplyAlpha: 'none' }).then(bm => {
    // 参数1：ImageBitmap或HTMLCanvasElement
    // 参数2: 图像颜色空间是否sRGB，true为sRGB颜色空间，false为线性颜色空间
    // 参数3：创建选项
    const texture = device.createTexture2DFromImage(bm, true, {
      samplerOptions: {
        magFilter: 'linear',
        minFilter: 'linear',
        mipFilter: 'linear',
        addressU: 'repeat',
        addressV: 'repeat'
      }
    })
  });
}

// 通过预先载入的纹理像素创建2D纹理
const data = LOAD_MIPMAP_DATA();
// 参数1：像素内容
// 参数2: 图像颜色空间是否sRGB，true为sRGB颜色空间，false为线性颜色空间
// 参数3：创建选项
const texture = device.createTexture2DFromMipmapData(data, false, {
  samplerOptions: {
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'nearest',
    addressU: 'clamp',
    addressV: 'clamp'
  }
});

```

以上是创建2D纹理的主要几种方式，还有类似创建2D数组纹理，3D纹理, 立方体纹理的方法，以下是相关的接口文档：

- [device.createTexture2DArray()](/doc/markdown/./device.abstractdevice.createtexture2darray)
- [device.createTexture2DArrayFromImages()](/doc/markdown/./device.abstractdevice.createtexture2darrayfromimages)
- [device.createTexture2DArrayFromMipmapData](/doc/markdown/./device.abstractdevice.createtexture2darrayfrommipmapdata)
- [device.createTexture3D()](/doc/markdown/./device.abstractdevice.createtexture3d)
- [device.createCubeTexture()](/doc/markdown/./device.abstractdevice.createcubetexture)
- [device.createCubeTextureFromMipmapData()](/doc/markdown/./device.abstractdevice.createcubetexturefrommipmapdata)
- [device.createTextureVideo()](/doc/markdown/./device.abstractdevice.createtexturevideo)

可用的纹理格式参见文档：[纹理格式](/doc/markdown/./device.textureformat)

## 更新纹理像素

```javascript

const texture = device.createTexture2D('rgba8unorm', 256, 256);
// 更新纹理区域(10,10,30,30)到红色
const pixels = new Uint8Array(20 * 20 * 4);
for (let i = 0; i < 20 * 20; i++) {
  pixels[i * 4 + 0] = 255;
  pixels[i * 4 + 1] = 0;
  pixels[i * 4 + 2] = 0;
  pixels[i * 4 + 3] = 255;
}
texture.update(pixels, 10, 10, 20, 20);

```

以下是关于纹理更新的接口文档：

- [Texture2D.update()](/doc/markdown/./device.texture2d.update)
- [Texture2D.updateFromElement()](/doc/markdown/./device.texture2d.updatefromelement)
- [Texture2DArray.update()](/doc/markdown/./device.texture2darray.update)
- [Texture2DArray.updateFromElement()](/doc/markdown/./device.texture2darray.updatefromelement)
- [Texture3D.update()](/doc/markdown/./device.texture3d.update)
- [TextureCube.update()](/doc/markdown/./device.texturecube.update)
- [TextureCube.updateFromElement()](/doc/markdown/./device.texturecube.updatefromelement)

## 自动生成mipmap

当纹理内容发生改变时，可以调用纹理接口的[generateMipmaps()](/doc/markdown/./device.basetexture.generatemipmaps)方法重新生成mipmap。

```javascript

// 更新纹理
texture.update(pixels, 0, 0, textureWidth, textureHeight);
// 生成mipmap
texture.generateMipmaps();

```

## 释放纹理

和Buffer一样，纹理会占用大量GPU内存，因此需要在不使用的时候进行释放。

```javascript

// 释放纹理
// 纹理释放后不能继续使用
texture.dispose();

```
