# Texture

## Create texture

The device interface offers various methods for creating textures.

```javascript

// Create 2D textures with a given pixel format and width and height.
const texture = device.createTexture2D('rgba8unorm', 256, 256);

// Create 2D textures with a given pixel format and width and height and specify the sampler states
const texture = device.createTexture2D('rgba8unorm', 256, 256, {
  // Sampler states
  samplerOptions: {
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'none',
    addressU: 'repeat',
    addressV: 'repeat'
  }
});

// Create writable 2D textures with a given pixel format and width and height (WebGPU only)
const texture = device.createTexture2D('rgba8unorm', 256, 256, {
  samplerOptions: { mipFilter: 'none' },
  writable: true
});

// Create 2D textures with Image
const img = document.createElement('img');
img.src = IMAGE_URL;
img.onLoad = function(){
  createImageBitmap(img, { premultiplyAlpha: 'none' }).then(bm => {
    // parameter 1：ImageBitmap or HTMLCanvasElement
    // parameter 2: Whether the image color space is sRGB, true is the sRGB color space, and false is the linear color space
    // parameter 3：Creation options
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

// Create 2D textures from pre-loaded texel values
const data = LOAD_MIPMAP_DATA();
// parameter 1：texel data
// parameter 2: Whether the image color space is sRGB, true is the sRGB color space, and false is the linear color space
// parameter 3：Creation options
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

The above are the primary ways to create 2D textures. Additionally, there are methods for creating 2D array textures, 3D textures, and cube textures.

- [device.createTextureFromMipmapData](/doc/markdown/./device.abstractdevice.createtexturefrommipmapdata)
- [device.createTexture2DArray()](/doc/markdown/./device.abstractdevice.createtexture2darray)
- [device.createTexture2DArrayFromImages()](/doc/markdown/./device.abstractdevice.createtexture2darrayfromimages)
- [device.createTexture3D()](/doc/markdown/./device.abstractdevice.createtexture3d)
- [device.createCubeTexture()](/doc/markdown/./device.abstractdevice.createcubetexture)
- [device.createTextureVideo()](/doc/markdown/./device.abstractdevice.createtexturevideo)

For available texture formats, refer to the documentation: [Texture formats](/doc/markdown/./device.textureformat)

## Update texture

```javascript

const texture = device.createTexture2D('rgba8unorm', 256, 256);
// Update the texture area (10, 10, 30, 30) to red
const pixels = new Uint8Array(20 * 20 * 4);
for (let i = 0; i < 20 * 20; i++) {
  pixels[i * 4 + 0] = 255;
  pixels[i * 4 + 1] = 0;
  pixels[i * 4 + 2] = 0;
  pixels[i * 4 + 3] = 255;
}
texture.update(pixels, 10, 10, 20, 20);

```

Here's the interface documentation for texture updates:

- [Texture2D.update()](/doc/markdown/./device.texture2d.update)
- [Texture2D.updateFromElement()](/doc/markdown/./device.texture2d.updatefromelement)
- [Texture2DArray.update()](/doc/markdown/./device.texture2darray.update)
- [Texture2DArray.updateFromElement()](/doc/markdown/./device.texture2darray.updatefromelement)
- [Texture3D.update()](/doc/markdown/./device.texture3d.update)
- [TextureCube.update()](/doc/markdown/./device.texturecube.update)
- [TextureCube.updateFromElement()](/doc/markdown/./device.texturecube.updatefromelement)

## Generat mipmap

When the content of a texture changes, the texture interface's [generateMipmaps()](/doc/markdown/./device.basetexture.generatemipmaps) method can be used to regenerate mipmap.

```javascript

// Update texture
texture.update(pixels, 0, 0, textureWidth, textureHeight);
// Generates mipmaps
texture.generateMipmaps();

```

## Dispose texture

Like Buffers, textures occupy a significant amount of GPU memory, so it's necessary to release them when they are not in use.

```javascript

// Dispose texture
// Textures cannot be used again after they have been disposed
texture.dispose();

```
