import { Quaternion, Vector3 } from '@zephyr3d/base';
import { getDevice, getEngine, Mesh, PlaneShape, UnlitMaterial } from '@zephyr3d/scene';
import { isCompressedTextureFormat } from '@zephyr3d/device';
import type { Texture2D } from '@zephyr3d/device';
import type { Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, placeCamera } from './common';

/**
 * Upright unlit quad showing one texture. PlaneShape is an XZ ground plane, so it
 * is turned to face +Z, towards the camera.
 */
function texturedQuad(scene: Scene, texture: Texture2D, size: number, x: number, y: number) {
  const material = new UnlitMaterial();
  material.albedoTexture = texture;
  const quad = new Mesh(scene, new PlaneShape({ size }), material);
  quad.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI / 2));
  quad.position.setXYZ(x, y, 0);
  return quad;
}

/**
 * Basis Universal KTX2 decoding, one quad per source encoding.
 *
 * Left column is ETC1S (BasisLZ supercompressed), right column UASTC; both files
 * are 40x40 sRGB with a full mip chain, from three.js examples/textures/ktx2 (MIT).
 * The large top quads sample mip 0, the small bottom ones the 5x5 and smaller
 * levels, which are not block aligned and exercise the small-mip upload path.
 *
 * The transcode target follows the device, so each backend baseline pins a
 * different path: on SwiftShader WebGPU, which exposes BC, ETC2 and ASTC, that
 * is ETC2 (ETC1S) and ASTC 4x4 (UASTC); a desktop GPU with only BC takes BC7.
 */
export const ktx2Basis: VisualScene = {
  name: 'ktx2-basis',
  description:
    'ETC1S and UASTC KTX2 textures transcoded for the device. Pins container parsing and format choice.',
  async setup({ scene, camera }) {
    bareScene(scene);
    const rm = getEngine().resourceManager;
    const [etc1s, uastc] = await Promise.all([
      rm.fetchTexture<Texture2D>('/assets/ktx2/2d_etc1s.ktx2'),
      rm.fetchTexture<Texture2D>('/assets/ktx2/2d_uastc.ktx2')
    ]);
    // The image alone cannot tell a block-compressed path from the RGBA8 fallback:
    // both decode the same source to nearly the same pixels. A broken format choice
    // that silently fell back everywhere would keep this baseline green, so it is
    // asserted instead.
    const caps = getDevice().getDeviceCaps().textureCaps;
    const hasBlockCompression = caps.supportS3TC || caps.supportBPTC || caps.supportETC2 || caps.supportASTC;
    for (const [label, tex] of [
      ['ETC1S', etc1s],
      ['UASTC', uastc]
    ] as const) {
      if (hasBlockCompression && !isCompressedTextureFormat(tex.format)) {
        throw new Error(`${label} KTX2 fell back to ${tex.format} on a device with block compression`);
      }
    }
    for (const tex of [etc1s, uastc]) {
      // Nearest magnification keeps the block structure of the decoded data visible
      tex.samplerOptions = { magFilter: 'nearest', minFilter: 'linear', mipFilter: 'nearest' };
    }
    texturedQuad(scene, etc1s, 2, -1.1, 0.55);
    texturedQuad(scene, uastc, 2, 1.1, 0.55);
    texturedQuad(scene, etc1s, 0.12, -1.1, -1.05);
    texturedQuad(scene, uastc, 0.12, 1.1, -1.05);
    placeCamera(camera, new Vector3(0, 0, 4.6));
  }
};
