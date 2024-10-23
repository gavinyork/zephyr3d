import { Vector2, Vector4 } from '@zephyr3d/base';
import type {
  SkyType,
  FogType,
  Scene,
  EnvLightType,
  ShadowMode,
  Compositor,
  AbstractPostEffect,
  Camera
} from '@zephyr3d/scene';
import { FFTWaveGenerator, GerstnerWaveGenerator } from '@zephyr3d/scene';
import {
  PunctualLight,
  AssetManager,
  Application,
  panoramaToCubemap,
  prefilterCubemap,
  Tonemap,
  SAO,
  PostWater,
  Bloom,
  PerspectiveCamera
} from '@zephyr3d/scene';
import { ImGui } from '@zephyr3d/imgui';
import type { Texture2D, BaseTexture, FrameBuffer } from '@zephyr3d/device';
import { TextureDrawer } from './textureview';

export function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

export interface TestCase {
  caseName: string;
  times: number;
  execute: () => void;
}

export function assert(exp, msg) {
  if (!exp) {
    throw new Error(msg);
  }
}

async function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function asyncWrapper(fn: Function, msg: HTMLElement, times: number) {
  return async function (...args: any[]) {
    try {
      for (const i of [...Array(times)].map((_, i) => i)) {
        msg.innerHTML = `testing... (${i}/${times})`;
        await Promise.resolve(fn(...args));
        await delay();
      }
      msg.style.color = '#00ff00';
      msg.innerHTML = 'Passed';
    } catch (err) {
      msg.style.color = '#ff0000';
      msg.innerHTML = `${err}`;
    }
  };
}

export async function doTest(desc: string, cases: TestCase[]) {
  const title = document.getElementById('title');
  title.textContent = `${desc} - testing`;
  const table = document.getElementById('test-results');
  for (const testcase of cases) {
    const tr = document.createElement('tr');
    const tdname = document.createElement('td');
    tdname.innerHTML = testcase.caseName;
    tr.appendChild(tdname);
    const tdresult = document.createElement('td');
    tr.appendChild(tdresult);
    table.appendChild(tr);
    await asyncWrapper(testcase.execute, tdresult, testcase.times)();
  }
  title.textContent = `${desc} - finished`;
}

export class Inspector {
  private _scene: Scene;
  private _compositor: Compositor;
  private _logs: string[];
  private _inspectLights: boolean;
  private _inspectScene: boolean;
  private _inspectTextures: boolean;
  private _inspectSky: boolean;
  private _inspectCamera: boolean;
  private _showLogs: boolean;
  private _currentTextureUid: number;
  private _currentTexture: BaseTexture;
  private _currentTextureMipLevel: number;
  private _currentTextureLayer: number;
  private _textureDrawer: TextureDrawer;
  private _textureFlip: boolean;
  private _textureLinear: boolean;
  private _textureRepeat: number;
  private _textureGammaCorrect: boolean;
  private _textureDrawMode: number;
  private _textureModes: number[];
  private _textureModeNames: string[];
  private _textureEncodes: number[];
  private _textureEncodeNames: string[];
  private _textureDrawEncode: number;
  private _framebuffer: FrameBuffer;
  private _envlightTypes: EnvLightType[];
  private _shadowMethods: ShadowMode[];
  private _skyTypes: SkyType[];
  private _fogTypes: FogType[];
  private _renderPostEffects: Set<AbstractPostEffect>;
  private _assetManager: AssetManager;
  private _camera: Camera;
  constructor(scene: Scene, compositor: Compositor, camera?: Camera) {
    this._scene = scene;
    this._compositor = compositor;
    this._camera = camera;
    this._logs = [];
    this._inspectLights = false;
    this._inspectScene = false;
    this._inspectTextures = false;
    this._inspectSky = false;
    this._inspectCamera = false;
    this._showLogs = false;
    this._currentTexture = null;
    this._currentTextureUid = -1;
    this._currentTextureMipLevel = 0;
    this._currentTextureLayer = 0;
    this._textureDrawer = new TextureDrawer();
    this._textureFlip = false;
    this._textureLinear = false;
    this._textureRepeat = 1;
    this._textureGammaCorrect = false;
    this._textureDrawMode = 0;
    this._textureModes = [
      TextureDrawer.RGBA,
      TextureDrawer.RGB,
      TextureDrawer.R,
      TextureDrawer.G,
      TextureDrawer.B,
      TextureDrawer.A,
      TextureDrawer.RG
    ];
    this._textureModeNames = ['RGBA', 'RGB', 'R', 'G', 'B', 'A', 'RG'];
    this._textureEncodes = [TextureDrawer.ENCODE_NORMAL, TextureDrawer.ENCODE_NORMALIZED_FLOAT];
    this._textureEncodeNames = ['Normal', 'RGBA encoded float'];
    this._textureDrawEncode = 0;
    this._framebuffer = null;
    this._envlightTypes = ['constant', 'hemisphere', 'ibl', 'none'];
    this._shadowMethods = ['hard', 'pcf-pd', 'pcf-opt', 'vsm', 'esm'];
    this._skyTypes = ['none', 'color', 'skybox', 'scatter'];
    this._fogTypes = ['none', 'linear', 'exp', 'exp2', 'scatter'];
    this._renderPostEffects = new Set();
    this._assetManager = null;
    this._assetManager = new AssetManager();
    const that = this;
    Application.instance.logger = {
      log(text, mode) {
        const prefix = mode ? `[${mode}] ` : '';
        that.log(`${prefix} ${text}`);
      }
    };
  }
  calculateSecionBoundsX(padding: number) {
    const window = ImGui.GetCurrentWindow();
    const start = ImGui.GetWindowPos().x;
    return [
      start + window.WindowPadding.x + padding,
      start + ImGui.GetWindowWidth() - window.WindowPadding.x - padding
    ];
  }
  chooseFile(multi: boolean, accept: string, callback: (files: File[]) => void) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = accept ?? '';
    fileInput.multiple = !!multi;
    fileInput.onchange = () => {
      callback && callback([...fileInput.files]);
    };
    fileInput.click();
  }
  log(str: string) {
    if (this._logs.length > 100) {
      this._logs.shift();
    }
    this._logs.push(str);
  }
  render() {
    this.renderMenuBar();
    this.renderStatusBar();
    if (this._inspectScene && this._scene) {
      this.renderScene();
    }
    if (this._inspectLights && this._scene) {
      this.renderLights();
    }
    if (this._inspectSky && this._scene) {
      this.renderSky();
    }
    if (this._inspectCamera && this._camera instanceof PerspectiveCamera) {
      this.renderPerspectiveCamera(this._camera);
    }
    if (this._inspectTextures) {
      this.renderTextureViewer();
    }
    if (this._showLogs) {
      this.renderLogs();
    }
    this.renderPostEffects();
  }
  private renderStatusBar() {
    if (ImGui.BeginStatusBar()) {
      ImGui.Text(`Device: ${Application.instance.device.type}`);
      ImGui.Text(`FPS: ${Application.instance.device.frameInfo.FPS.toFixed(2)}`);
      ImGui.Text(`DrawCall: ${Application.instance.device.frameInfo.drawCalls}`);
      ImGui.Text(`CPU time: ${Number(Application.instance.device.frameInfo.elapsedTimeCPU).toFixed(2)}`);
      ImGui.Text(`GPU time: ${Number(Application.instance.device.frameInfo.elapsedTimeGPU).toFixed(2)}`);
      ImGui.EndStatusBar();
    }
  }
  private renderMenuBar() {
    if (ImGui.BeginMainMenuBar()) {
      if (ImGui.BeginMenu('Edit##scene')) {
        if (ImGui.BeginMenu('Add##sceneobject')) {
          if (ImGui.MenuItem('Box')) {
            alert('Create box');
          }
          if (ImGui.MenuItem('Sphere')) {
            alert('Create sphere');
          }
          if (ImGui.MenuItem('Plane')) {
            alert('Create plane');
          }
          if (ImGui.MenuItem('Cylinder')) {
            alert('Create cylinder');
          }
          ImGui.EndMenu();
        }
        ImGui.EndMenu();
      }
      if (ImGui.BeginMenu('Inspector')) {
        ImGui.MenuItem('Scene', null, (val?: boolean) => {
          return (this._inspectScene = val ?? this._inspectScene);
        });
        if (this._camera) {
          ImGui.MenuItem('Camera', null, (val?: boolean) => {
            return (this._inspectCamera = val ?? this._inspectCamera);
          });
        }
        ImGui.MenuItem('Lights', null, (val?: boolean) => {
          return (this._inspectLights = val ?? this._inspectLights);
        });
        ImGui.MenuItem('Textures', null, (val?: boolean) => {
          return (this._inspectTextures = val ?? this._inspectTextures);
        });
        ImGui.MenuItem('Sky&Fog', null, (val?: boolean) => {
          return (this._inspectSky = val ?? this._inspectSky);
        });
        ImGui.MenuItem('Show logs', null, (val?: boolean) => {
          return (this._showLogs = val ?? this._showLogs);
        });
        ImGui.EndMenu();
      }
      if (this._compositor) {
        const postEffects = this._compositor.getPostEffects();
        this._renderPostEffects.forEach((val) => {
          if (postEffects.indexOf(val) < 0) {
            this._renderPostEffects.delete(val);
          }
        });
        if (postEffects.length > 0 && ImGui.BeginMenu('Compositor')) {
          for (const eff of postEffects) {
            const name = eff.constructor.name;
            ImGui.MenuItem(name, null, (val?: boolean) => {
              if (val === undefined || val === null) {
                val = this._renderPostEffects.has(eff);
              } else if (val) {
                this._renderPostEffects.add(eff);
              } else {
                this._renderPostEffects.delete(eff);
              }
              return val;
            });
          }
          ImGui.EndMenu();
        }
      }
      ImGui.EndMainMenuBar();
    }
  }
  private renderPostEffects() {
    for (const eff of this._renderPostEffects) {
      if (eff instanceof Tonemap) {
        this.renderTonemap(eff);
      } else if (eff instanceof SAO) {
        this.renderSAO(eff);
      } else if (eff instanceof PostWater) {
        this.renderPostWater(eff);
      } else if (eff instanceof Bloom) {
        this.renderBloom(eff);
      }
    }
  }
  private renderPostWaterCommon(water: PostWater) {
    const wireframe = [water.wireframe] as [boolean];
    if (ImGui.Checkbox('Wireframe##water', wireframe)) {
      water.wireframe = wireframe[0];
    }
    const ssr = [water.ssr] as [boolean];
    if (ImGui.Checkbox('SSR##water', ssr)) {
      water.ssr = ssr[0];
    }
    ImGui.SliderFloat(
      'GridScale##water',
      (val?: number) => {
        return (water.gridScale = val = val ?? water.gridScale);
      },
      0,
      1
    );
    ImGui.SliderFloat(
      'Speed##water',
      (val?: number) => {
        return (water.speed = val = val ?? water.speed);
      },
      0,
      10
    );
    ImGui.SliderFloat(
      'Elevation##water',
      (val?: number) => {
        return (water.elevation = val = val ?? water.elevation);
      },
      -100,
      100
    );
    const region = Array.from(water.boundary) as [number, number, number, number];
    if (ImGui.SliderFloat4('Region##water', region, -1000, 1000)) {
      water.boundary.set(region);
    }
    ImGui.SliderFloat(
      'SSRMaxDistance##water',
      (val?: number) => (water.ssrMaxDistance = val = val ?? water.ssrMaxDistance),
      0,
      1000
    );
    ImGui.SliderInt(
      'SSRIterations##water',
      (val?: number) => (water.ssrIterations = val = val ?? water.ssrIterations),
      1,
      200
    );
    ImGui.SliderFloat(
      'SSRThickness##water',
      (val?: number) => (water.ssrThickness = val = val ?? water.ssrThickness),
      0,
      5
    );
    ImGui.SliderFloat(
      'AntiReflectanceLeak##water',
      (val?: number) => (water.antiReflectanceLeak = val = val ?? water.antiReflectanceLeak),
      0,
      10
    );
    ImGui.SliderFloat(
      'Displace##water',
      (val?: number) => {
        return (water.displace = val = val ?? water.displace);
      },
      1,
      100
    );
    ImGui.SliderFloat(
      'DepthMulti##water',
      (val?: number) => {
        return (water.depthMulti = val = val ?? water.depthMulti);
      },
      0,
      1
    );
    ImGui.SliderFloat(
      'RefractionStrength##water',
      (val?: number) => {
        return (water.refractionStrength = val = val ?? water.refractionStrength);
      },
      -1,
      1
    );
    const slope = [water.causticsSlopeMin, water.causticsSlopeMax] as [number, number];
    if (ImGui.SliderFloat2('CausticsSlope##water', slope, 0, 1)) {
      water.causticsSlopeMin = slope[0];
      water.causticsSlopeMax = slope[1];
    }
    ImGui.SliderFloat(
      'CausticsFalloff##water',
      (val?: number) => {
        return (water.causticsFalloff = val = val ?? water.causticsFalloff);
      },
      0,
      32
    );
    ImGui.SliderFloat(
      'CausticsIntensity##water',
      (val?: number) => {
        return (water.causticsIntensity = val = val ?? water.causticsIntensity);
      },
      0,
      1000
    );
  }
  private renderPostWater(water: PostWater) {
    if (ImGui.Begin('PostWater')) {
      this.renderPostWaterCommon(water);
      if (water.waveGenerator instanceof FFTWaveGenerator) {
        this.renderPostWaterFFT(water);
      } else if (water.waveGenerator instanceof GerstnerWaveGenerator) {
        this.renderPostWaterGerstner(water);
      }
    }
    ImGui.End();
  }
  private renderPostWaterGerstner(water: PostWater) {
    const t = water.waveGenerator as GerstnerWaveGenerator;
    const numWaves = [t.numWaves] as [number];
    if (ImGui.SliderInt('WaveCount##water', numWaves, 1, 64)) {
      t.numWaves = numWaves[0];
    }
    for (let i = 0; i < t.numWaves; i++) {
      ImGui.PushID(i);
      if (ImGui.CollapsingHeader(`Wave${i}`)) {
        const omni = [t.isOmniWave(i)] as [boolean];
        if (ImGui.Checkbox(`Omni##Wave${i}`, omni)) {
          t.setOmniWave(i, omni[0]);
        }
        if (omni[0]) {
          const origin = [t.getOriginX(i), t.getOriginZ(i)] as [number, number];
          if (ImGui.SliderFloat2(`Origin##Wave${i}`, origin, -500, 500)) {
            t.setOrigin(i, origin[0], origin[1]);
          }
        } else {
          const direction = [t.getWaveDirectionX(i), t.getWaveDirectionY(i)] as [number, number];
          if (ImGui.SliderFloat2(`Direction##Wave${i}`, direction, -1, 1)) {
            t.setWaveDirection(i, direction[0], direction[1]);
          }
        }
        const steepness = [t.getWaveAmplitude(i)] as [number];
        if (ImGui.SliderFloat(`Steepness##Wave${i}`, steepness, 0, 1)) {
          t.setWaveAmplitude(i, steepness[0]);
        }
        const waveLength = [t.getWaveLength(i)] as [number];
        if (ImGui.SliderFloat(`WaveLength##Wave${i}`, waveLength, 0, 100)) {
          t.setWaveLength(i, waveLength[0]);
        }
      }
      ImGui.PopID();
    }
  }
  private renderPostWaterFFT(water: PostWater) {
    const g = water.waveGenerator as FFTWaveGenerator;
    const tmpWind = new Vector2(g.wind);
    if (ImGui.SliderFloat2('Wind', tmpWind, 0, 64)) {
      g.wind = tmpWind;
    }
    ImGui.SliderFloat(
      'FoamWidth##water',
      (val?: number) => {
        return (g.foamWidth = val = val ?? g.foamWidth);
      },
      0,
      2
    );
    ImGui.SliderFloat(
      'FoamContrast##water',
      (val?: number) => {
        return (g.foamContrast = val = val ?? g.foamContrast);
      },
      0,
      8
    );
    const alignment = [g.alignment] as [number];
    if (ImGui.SliderFloat('alignment', alignment, 0, 4)) {
      g.alignment = alignment[0];
    }
    for (let i = 0; i < 3; i++) {
      const size = [g.getWaveLength(i)] as [number];
      if (ImGui.SliderFloat(`Size${i}`, size, 0, 1000)) {
        g.setWaveLength(i, size[0]);
      }
      const strength = [g.getWaveStrength(i)] as [number];
      if (ImGui.SliderFloat(`Strength${i}`, strength, 0, 10)) {
        g.setWaveStrength(i, strength[0]);
      }
      const croppiness = [g.getWaveCroppiness(i)] as [number];
      if (ImGui.SliderFloat(`Croppiness${i}`, croppiness, -2, 2)) {
        g.setWaveCroppiness(i, croppiness[0]);
      }
    }
  }
  private renderSAO(sao: SAO) {
    if (ImGui.Begin('SAO')) {
      ImGui.DragFloat(
        'Scale##sao',
        (val?: number) => {
          return (sao.scale = val = val ?? sao.scale);
        },
        0.01,
        0,
        10
      );
      ImGui.DragFloat(
        'Bias##sao',
        (val?: number) => {
          return (sao.bias = val = val ?? sao.bias);
        },
        0.01,
        -1,
        1
      );
      ImGui.DragFloat(
        'Intensity##sao',
        (val?: number) => {
          return (sao.intensity = val = val ?? sao.intensity);
        },
        0.01,
        0,
        1
      );
      ImGui.DragFloat(
        'Radius##sao',
        (val?: number) => {
          return (sao.radius = val = val ?? sao.radius);
        },
        0.01,
        1,
        100
      );
      ImGui.DragFloat(
        'minResolution##sao',
        (val?: number) => {
          return (sao.minResolution = val = val ?? sao.minResolution);
        },
        0.01,
        0,
        1
      );
      ImGui.SliderFloat(
        'blurKernelSize',
        (val?: number) => {
          return (sao.blurKernelSize = val = val ?? sao.blurKernelSize);
        },
        0,
        64
      );
      ImGui.SliderFloat(
        'blurStdDev',
        (val?: number) => {
          return (sao.blurStdDev = val = val ?? sao.blurStdDev);
        },
        0,
        128
      );
      ImGui.SliderFloat(
        'blurDepthCutoff',
        (val?: number) => {
          return (sao.blurDepthCutoff = val = val ?? sao.blurDepthCutoff);
        },
        0,
        1
      );
    }
    ImGui.End();
  }
  private renderBloom(bloom: Bloom) {
    if (ImGui.Begin('Bloom')) {
      const maxDownsampleLevel = [bloom.maxDownsampleLevel] as [number];
      if (ImGui.SliderInt('MaxDownsampleLevel##Bloom', maxDownsampleLevel, 1, 16)) {
        bloom.maxDownsampleLevel = maxDownsampleLevel[0];
      }
      const downsampleLimit = [bloom.downsampleLimit] as [number];
      if (ImGui.SliderInt('DownsampleLimit##Bloom', downsampleLimit, 1, 512)) {
        bloom.downsampleLimit = downsampleLimit[0];
      }
      const threshold = [bloom.threshold] as [number];
      if (ImGui.SliderFloat('Threshold##Bloom', threshold, 0, 16)) {
        bloom.threshold = threshold[0];
      }
      const knee = [bloom.thresholdKnee] as [number];
      if (ImGui.SliderFloat('Knee##Bloom', knee, 0, 1)) {
        bloom.thresholdKnee = knee[0];
      }
      const intensity = [bloom.intensity] as [number];
      if (ImGui.SliderFloat('Intensity##Bloom', intensity, 0, 100)) {
        bloom.intensity = intensity[0];
      }
    }
    ImGui.End();
  }
  private renderTonemap(tonemap: Tonemap) {
    if (ImGui.Begin('Tonemap')) {
      const exposure = [tonemap.exposure] as [number];
      if (ImGui.SliderFloat('Exposure##Tonemap', exposure, 0, 16)) {
        tonemap.exposure = exposure[0];
      }
    }
    ImGui.End();
  }
  private renderSky() {
    ImGui.Begin('Sky & Fog');
    const sky = this._scene.env.sky;
    if (ImGui.CollapsingHeader('Sky & Fog')) {
      ImGui.Combo(
        'Type##sky',
        (val?: number) => {
          if (val === undefined) {
            val = this._skyTypes.indexOf(sky.skyType);
          } else {
            sky.skyType = this._skyTypes[val];
          }
          return val;
        },
        this._skyTypes
      );
      ImGui.Checkbox('AutoUpdateIBLMaps##sky', (val?: boolean) => {
        if (val === undefined) {
          val = sky.autoUpdateIBLMaps;
        } else {
          sky.autoUpdateIBLMaps = val;
        }
        return val;
      });
      if (sky.skyType === 'color') {
        const rgbSkyColor = [...sky.skyColor] as [number, number, number];
        if (ImGui.ColorEdit3('Color##sky', rgbSkyColor)) {
          sky.skyColor = new Vector4(rgbSkyColor[0], rgbSkyColor[1], rgbSkyColor[2], 1);
        }
      } else if (sky.skyType === 'skybox') {
        if (ImGui.Button('Select CubeMap')) {
          this.chooseFile(false, '.hdr,.dds', (files) => {
            const url = URL.createObjectURL(files[0]);
            const isHDR = files[0].name.toLowerCase().endsWith('.hdr');
            const isDDS = files[0].name.toLowerCase().endsWith('.dds');
            if (isHDR || isDDS) {
              this._assetManager
                .fetchTexture(url, {
                  mimeType: isHDR ? 'image/hdr' : 'image/dds',
                  samplerOptions: { mipFilter: 'none' }
                })
                .then((tex) => {
                  if (tex.isTextureCube()) {
                    this._scene.env.sky.skyboxTexture = tex;
                  } else if (tex.isTexture2D()) {
                    const skyMap = Application.instance.device.createCubeTexture('rgba16f', 512);
                    panoramaToCubemap(tex, skyMap);
                    this._scene.env.sky.skyboxTexture = skyMap;
                    tex.dispose();
                  }
                });
            }
          });
        }
      } else if (sky.skyType === 'scatter') {
        const cloudy = [sky.cloudy] as [number];
        if (ImGui.SliderFloat('Cloudy##sky', cloudy, 0, 8)) {
          sky.cloudy = cloudy[0];
        }
        const cloudIntensity = [sky.cloudIntensity] as [number];
        if (ImGui.SliderFloat('CloudIntensity##sky', cloudIntensity, 0, 100)) {
          sky.cloudIntensity = cloudIntensity[0];
        }
        const wind = sky.wind;
        ImGui.SliderFloat2('Wind##sky', wind, -1000, 1000);
      }
    }
    if (ImGui.CollapsingHeader('Fog')) {
      ImGui.Combo(
        'Type##fog',
        (val?: number) => {
          if (val === undefined) {
            val = this._fogTypes.indexOf(sky.fogType);
          } else {
            sky.fogType = this._fogTypes[val];
          }
          return val;
        },
        this._fogTypes
      );
      if (sky.fogType !== 'none' && sky.fogType !== 'scatter') {
        const rgbFog = [...sky.fogColor] as [number, number, number];
        if (ImGui.ColorEdit3('Color##fog', rgbFog)) {
          sky.fogColor = new Vector4(rgbFog[0], rgbFog[1], rgbFog[2], 1);
        }
        if (sky.fogType === 'linear') {
          ImGui.InputFloat(
            'Start##fog',
            (val?: number) => {
              return (sky.fogStart = val = val ?? sky.fogStart);
            },
            0,
            0,
            null,
            ImGui.InputTextFlags.EnterReturnsTrue
          );
          ImGui.InputFloat(
            'End##fog',
            (val?: number) => {
              return (sky.fogEnd = val = val ?? sky.fogEnd);
            },
            0,
            0,
            null,
            ImGui.InputTextFlags.EnterReturnsTrue
          );
        } else if (sky.fogType === 'exp' || sky.fogType === 'exp2') {
          ImGui.DragFloat(
            'Density##fog',
            (val?: number) => {
              return (sky.fogDensity = val = val ?? sky.fogDensity);
            },
            0.001,
            0,
            1
          );
        }
        ImGui.InputFloat(
          'Top##fog',
          (val?: number) => {
            return (sky.fogTop = val = val ?? sky.fogTop);
          },
          0,
          0,
          null,
          ImGui.InputTextFlags.EnterReturnsTrue
        );
      }
    }
    ImGui.End();
  }
  private getLightList(): PunctualLight[] {
    const lightlist: PunctualLight[] = [];
    this._scene.rootNode.traverse({
      visit(target: unknown) {
        if (target instanceof PunctualLight) {
          lightlist.push(target);
        }
      }
    });
    return lightlist;
  }
  private renderPerspectiveCamera(camera: PerspectiveCamera) {
    if (ImGui.Begin('Camera')) {
      const pos = camera.getWorldPosition();
      ImGui.Text(`${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`);
      ImGui.Checkbox('Generate HiZ', (val?: boolean) => {
        if (val === undefined) {
          val = camera.HiZ;
        } else {
          camera.HiZ = val;
        }
        return val;
      });
      ImGui.SliderFloat(
        'NearPlane',
        (val?: number) => {
          camera.near = val = val ?? camera.near;
          return val;
        },
        0,
        1000
      );
      ImGui.SliderFloat(
        'FarPlane',
        (val?: number) => {
          camera.far = val = val ?? camera.far;
          return val;
        },
        0,
        10000
      );
      ImGui.SliderFloat(
        'FovY',
        (val?: number) => {
          if (val === undefined) {
            val = (camera.fovY * 180) / Math.PI;
          } else {
            camera.fovY = (val * Math.PI) / 180;
          }
          return val;
        },
        0,
        180
      );
      const vp = [0, 0, 0, 0] as [number, number, number, number];
      if (camera.viewport) {
        vp[0] = camera.viewport[0];
        vp[1] = camera.viewport[1];
        vp[2] = camera.viewport[2];
        vp[3] = camera.viewport[3];
      } else {
        vp[0] = Application.instance.device.getViewport().x;
        vp[1] = Application.instance.device.getViewport().y;
        vp[2] = Application.instance.device.getViewport().width;
        vp[3] = Application.instance.device.getViewport().height;
      }
      if (ImGui.SliderInt4('Viewport', vp, 0, 4096)) {
        camera.viewport = vp;
      }
      const window = [0, 0, 0, 0] as [number, number, number, number];
      if (camera.window) {
        window[0] = camera.window[0];
        window[1] = camera.window[1];
        window[2] = camera.window[2];
        window[3] = camera.window[3];
      }
      if (ImGui.SliderFloat4('Window', window, 0, 1)) {
        if (window[0] || window[1] || window[2] || window[3]) {
          camera.window = window;
        } else {
          camera.window = null;
        }
      }
      ImGui.BeginSection('ScreenSpaceReflection');
      ImGui.Checkbox('Enabled', (val?: boolean) => {
        if (val === undefined) {
          val = camera.SSR;
        } else {
          camera.SSR = val;
        }
        return val;
      });
      if (camera.SSR) {
        ImGui.SliderFloat(
          'SSRMaxRoughness',
          (val?: number) => (camera.ssrMaxRoughness = val = val ?? camera.ssrMaxRoughness),
          0,
          1
        );
        ImGui.SliderFloat(
          'SSRRoughnessFactor',
          (val?: number) => (camera.ssrRoughnessFactor = val = val ?? camera.ssrRoughnessFactor),
          0,
          1
        );
        ImGui.SliderInt(
          'SSRStride',
          (val?: number) => (camera.ssrStride = val = val ?? camera.ssrStride),
          1,
          16
        );
        ImGui.SliderFloat(
          'SSRMaxDistance##Camera',
          (val?: number) => (camera.ssrMaxDistance = val = val ?? camera.ssrMaxDistance),
          0,
          1000
        );
        ImGui.SliderInt(
          'SSRIterations##Camera',
          (val?: number) => (camera.ssrIterations = val = val ?? camera.ssrIterations),
          1,
          500
        );
        ImGui.SliderFloat(
          'SSRThickness##Camera',
          (val?: number) => (camera.ssrThickness = val = val ?? camera.ssrThickness),
          0,
          5
        );
        ImGui.Checkbox('SSRCalcThickness##Camera', (val?: boolean) => {
          if (val === undefined) {
            val = camera.ssrCalcThickness;
          } else {
            camera.ssrCalcThickness = val;
          }
          return val;
        });
        ImGui.SliderFloat(
          'SSRBlurriness##Camera',
          (val?: number) => {
            if (val === undefined) {
              val = camera.ssrBlurriness;
            } else {
              camera.ssrBlurriness = val;
            }
            return val;
          },
          0,
          1
        );
        ImGui.SliderFloat(
          'SSRBlurDepthCutoff##Camera',
          (val?: number) => {
            if (val === undefined) {
              val = camera.ssrBlurDepthCutoff;
            } else {
              camera.ssrBlurDepthCutoff = val;
            }
            return val;
          },
          0,
          10
        );
        ImGui.SliderFloat(
          'SSRBlurKernelRadius##Camera',
          (val?: number) => {
            if (val === undefined) {
              val = camera.ssrBlurKernelRadius;
            } else {
              camera.ssrBlurKernelRadius = val;
            }
            return val;
          },
          0,
          15
        );
        ImGui.SliderFloat(
          'SSRBlurStdDev##Camera',
          (val?: number) => {
            if (val === undefined) {
              val = camera.ssrBlurStdDev;
            } else {
              camera.ssrBlurStdDev = val;
            }
            return val;
          },
          0,
          32
        );
        const debugOptions = ['none', 'reflectBRDF', 'roughness', 'reflectance', 'strength'] as const;
        const currentDebug = [debugOptions.indexOf(camera.ssrDebug)] as [number];
        if (ImGui.Combo('Debug', currentDebug, debugOptions as unknown as string[])) {
          camera.ssrDebug = debugOptions[currentDebug[0]];
        }
      }
      ImGui.EndSection(1);
    }
    ImGui.End();
  }
  private renderScene() {
    ImGui.SetNextWindowSize(new ImGui.ImVec2(0, 0), ImGui.Cond.FirstUseEver);
    ImGui.Begin('Scene');
    const density = [this._scene.env.sky.aerialPerspectiveDensity] as [number];
    if (ImGui.SliderFloat('ScatterFogDensity', density, 1, 50)) {
      this._scene.env.sky.aerialPerspectiveDensity = density[0];
    }
    ImGui.End();
  }
  private renderLights() {
    const lights = this.getLightList();
    ImGui.SetNextWindowSize(new ImGui.ImVec2(0, 0), ImGui.Cond.FirstUseEver);
    ImGui.Begin('Lights');
    let currentIndex = this._envlightTypes.indexOf(this._scene.env.light.type);
    if (currentIndex >= 0) {
      if (ImGui.CollapsingHeader('Environment light')) {
        ImGui.SliderFloat(
          'Strength',
          (val?: number) => {
            this._scene.env.light.strength = val = val ?? this._scene.env.light.strength;
            return val;
          },
          0,
          1
        );
        ImGui.Combo(
          'type',
          (index?: number) => {
            if (index === undefined) {
              index = currentIndex;
            } else {
              currentIndex = index;
              this._scene.env.light.type = this._envlightTypes[index];
            }
            return index;
          },
          this._envlightTypes
        );
        if (this._envlightTypes[currentIndex] === 'ibl') {
          if (ImGui.Button('Select HDR texture')) {
            this.chooseFile(false, '.hdr', (files) => {
              const url = URL.createObjectURL(files[0]);
              this._assetManager
                .fetchTexture<Texture2D>(url, {
                  mimeType: 'image/hdr',
                  samplerOptions: { mipFilter: 'none' }
                })
                .then((tex) => {
                  const skyMap = Application.instance.device.createCubeTexture('rgba16f', 512);
                  const radianceMap = Application.instance.device.createCubeTexture('rgba16f', 256);
                  const irradianceMap = Application.instance.device.createCubeTexture('rgba16f', 64, {
                    samplerOptions: { mipFilter: 'none' }
                  });
                  panoramaToCubemap(tex, skyMap);
                  prefilterCubemap(skyMap, 'ggx', radianceMap);
                  prefilterCubemap(skyMap, 'lambertian', irradianceMap);
                  tex.dispose();
                  this._scene.env.light.radianceMap = radianceMap;
                  this._scene.env.light.irradianceMap = irradianceMap;
                });
            });
          }
          if (ImGui.Button('Use sky IBL maps')) {
            this._scene.env.light.radianceMap = this._scene.env.sky.radianceMap;
            this._scene.env.light.irradianceMap = this._scene.env.sky.irradianceMap;
          }
        } else if (this._envlightTypes[currentIndex] === 'hemisphere') {
          const rgbUp = {
            r: this._scene.env.light.ambientUp.x,
            g: this._scene.env.light.ambientUp.y,
            b: this._scene.env.light.ambientUp.z
          };
          if (ImGui.ColorEdit3('Up color', rgbUp)) {
            this._scene.env.light.ambientUp = new Vector4(rgbUp.r, rgbUp.g, rgbUp.b, 1);
          }
          const rgbDown = {
            r: this._scene.env.light.ambientDown.x,
            g: this._scene.env.light.ambientDown.y,
            b: this._scene.env.light.ambientDown.z
          };
          if (ImGui.ColorEdit3('Down color', rgbDown)) {
            this._scene.env.light.ambientDown = new Vector4(rgbDown.r, rgbDown.g, rgbDown.b, 1);
          }
        } else if (this._envlightTypes[currentIndex] === 'constant') {
          const rgb = {
            r: this._scene.env.light.ambientColor.x,
            g: this._scene.env.light.ambientColor.y,
            b: this._scene.env.light.ambientColor.z
          };
          if (ImGui.ColorEdit3('Ambient color', rgb)) {
            this._scene.env.light.ambientColor = new Vector4(rgb.r, rgb.g, rgb.b, 1);
          }
        }
      }
    }
    for (let i = 0; i < lights.length; i++) {
      ImGui.PushID(i);
      const type = lights[i].isDirectionLight()
        ? 'Directional light'
        : lights[i].isPointLight()
        ? 'Point light'
        : 'Spot light';
      if (ImGui.CollapsingHeader(type)) {
        this.editLight(lights[i]);
      }
      ImGui.PopID();
    }
    ImGui.End();
  }
  private renderLogs() {
    if (this._logs.length > 0) {
      ImGui.SetNextWindowSize(new ImGui.ImVec2(0, 200), ImGui.Cond.FirstUseEver);
      ImGui.Begin('Logs');
      for (let i = 0; i < this._logs.length; i++) {
        ImGui.Text(this._logs[i]);
      }
      if (ImGui.GetScrollY() >= ImGui.GetScrollMaxY()) {
        ImGui.SetScrollHereY(1.0);
      }
      ImGui.End();
    }
  }
  private renderTextureViewer() {
    const textureList = Application.instance.device.getGPUObjects().textures;
    const textureNameList = textureList
      .filter((tex) => !tex.isTexture3D())
      .sort((a, b) => a.uid - b.uid)
      .map((tex) => this.textureToListName(tex));
    if (textureNameList.length > 0) {
      if (!this._framebuffer) {
        const renderTarget = Application.instance.device.createTexture2D('rgba8unorm', 512, 512, {
          samplerOptions: { mipFilter: 'none' }
        });
        renderTarget.name = '!!textureviewer';
        this._framebuffer = Application.instance.device.createFrameBuffer([renderTarget], null);
        this._framebuffer.setColorAttachmentGenerateMipmaps(0, false);
      }
      ImGui.Begin('Texture viewer');
      let tindex =
        this._currentTextureUid < 0
          ? -1
          : textureNameList.findIndex((val) => {
              const k = val.split('##');
              const uid = Number(k[k.length - 1]);
              return uid === this._currentTextureUid;
            });
      if (tindex < 0) {
        tindex = 0;
        this._currentTextureMipLevel = 0;
        this._currentTextureLayer = 0;
      }
      const t = [tindex] as [number];
      if (ImGui.Combo('Textures', t, textureNameList)) {
        tindex = t[0];
        this._currentTextureMipLevel = 0;
        this._currentTextureLayer = 0;
      }
      const k = textureNameList[tindex].split('##');
      this._currentTextureUid = Number(k[k.length - 1]);
      this._currentTexture = Application.instance.device.getGPUObjectById(
        this._currentTextureUid
      ) as BaseTexture;
      if (this._currentTexture) {
        const mipLevelCount = this._currentTexture.mipLevelCount;
        const miplevel = [this._currentTextureMipLevel] as [number];
        if (
          ImGui.Combo(
            'MipLevel',
            miplevel,
            Array.from({ length: mipLevelCount }).map((val, index) => String(index))
          )
        ) {
          this._currentTextureMipLevel = miplevel[0];
        }
        if (this._currentTexture.isTextureCube()) {
          const cubeFace = [this._currentTextureLayer] as [number];
          if (ImGui.Combo('CubeFace', cubeFace, ['Pos X', 'Neg X', 'Pos Y', 'Neg Y', 'Pos Z', 'Neg Z'])) {
            this._currentTextureLayer = cubeFace[0];
          }
        }
        if (this._currentTexture.isTexture2DArray()) {
          const layer = [this._currentTextureLayer] as [number];
          if (ImGui.DragInt('ArrayIndex', layer, 1, 0, this._currentTexture.depth - 1)) {
            this._currentTextureLayer = layer[0];
          }
        }
        const renderMode = [this._textureDrawMode] as [number];
        if (ImGui.Combo('Mode', renderMode, this._textureModeNames)) {
          this._textureDrawMode = renderMode[0];
        }
        const renderEncode = [this._textureDrawEncode] as [number];
        if (ImGui.Combo('Encode', renderEncode, this._textureEncodeNames)) {
          this._textureDrawEncode = renderEncode[0];
        }
        const repeat = [this._textureRepeat] as [number];
        if (ImGui.SliderInt('Repeat', repeat, 0, 8)) {
          this._textureRepeat = repeat[0];
        }
        const colorScale = [this._textureDrawer.colorScale] as [number];
        if (ImGui.SliderFloat('ColorScale', colorScale, 1, 800)) {
          this._textureDrawer.colorScale = colorScale[0];
        }
        ImGui.Checkbox('Vertical flip', (val?: boolean) => {
          if (val === undefined) {
            val = this._textureFlip;
          } else {
            this._textureFlip = val;
          }
          return val;
        });
        ImGui.Checkbox('Linear', (val?: boolean) => {
          if (val === undefined) {
            val = this._textureLinear;
          } else {
            this._textureLinear = val;
          }
          return val;
        });
        ImGui.Checkbox('sRGB', (val?: boolean) => {
          if (val === undefined) {
            val = this._textureGammaCorrect;
          } else {
            this._textureGammaCorrect = val;
          }
          return val;
        });
      }
      Application.instance.device.pushDeviceStates();
      Application.instance.device.setFramebuffer(this._framebuffer);
      Application.instance.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
      this._textureDrawer.draw(
        this._currentTexture,
        this._textureRepeat,
        this._textureGammaCorrect,
        this._textureLinear,
        this._textureFlip,
        this._textureEncodes[this._textureDrawEncode],
        this._textureModes[this._textureDrawMode],
        this._currentTextureMipLevel,
        this._currentTextureLayer
      );
      Application.instance.device.popDeviceStates();
      const width = ImGui.GetContentRegionAvail().x;
      const height = this._currentTexture
        ? Math.floor((width / this._currentTexture.width) * this._currentTexture.height)
        : width;
      ImGui.Image(this._framebuffer.getColorAttachments()[0] as Texture2D, new ImGui.ImVec2(width, height));
      ImGui.End();
    }
    //ImGui.Combo()
  }
  private editLight(light: PunctualLight) {
    ImGui.Checkbox('Enabled', (val?: boolean) => {
      if (val === undefined) {
        val = light.showState !== 'hidden';
      } else {
        light.showState = val ? 'visible' : 'hidden';
      }
      return val;
    });
    ImGui.BeginSection('Shadow');
    ImGui.Checkbox('CastShadow', (val?: boolean) => {
      if (val === undefined) {
        val = light.castShadow;
      } else {
        light.castShadow = val;
      }
      return val;
    });
    if (light.castShadow) {
      ImGui.InputInt(
        'ShadowMapSize',
        (val?: number) => {
          if (val === undefined) {
            val = light.shadow.shadowMapSize;
          } else {
            val = Math.max(Math.min(val, 4096), 0);
            light.shadow.shadowMapSize = Math.max(Math.min(val, 4096), 0);
          }
          return val;
        },
        0,
        0,
        ImGui.InputTextFlags.EnterReturnsTrue
      );
      ImGui.SliderFloat(
        'ShadowDistance',
        (val?: number) => {
          return (light.shadow.shadowDistance = val = val ?? light.shadow.shadowDistance);
        },
        0,
        2000
      );
      ImGui.DragFloat(
        'DepthBias',
        (val?: number) => {
          return (light.shadow.depthBias = val = val ?? light.shadow.depthBias);
        },
        0.001,
        0,
        1
      );
      ImGui.DragFloat(
        'NormalBias',
        (val?: number) => {
          return (light.shadow.normalBias = val = val ?? light.shadow.normalBias);
        },
        0.001,
        0,
        1
      );
      ImGui.Combo(
        'Method',
        (val?: number) => {
          if (val === undefined) {
            val = this._shadowMethods.indexOf(light.shadow.mode);
          } else {
            light.shadow.mode = this._shadowMethods[val];
          }
          return val;
        },
        this._shadowMethods
      );
      if (light.isDirectionLight()) {
        ImGui.DragInt(
          'Cascades',
          (val?: number) => {
            return (light.shadow.numShadowCascades = val = val ?? light.shadow.numShadowCascades);
          },
          1,
          1,
          4
        );
      }
      if (light.shadow.mode === 'esm') {
        ImGui.DragFloat('ESMDepthScale', (val?: number) => {
          return (light.shadow.esmDepthScale = val = val ?? light.shadow.esmDepthScale);
        });
        ImGui.Checkbox('ESMBlur', (val?: boolean) => {
          return (light.shadow.esmBlur = val = val ?? light.shadow.esmBlur);
        });
        if (light.shadow.esmBlur) {
          ImGui.DragInt(
            'ESMBlurKernelSize',
            (val?: number) => {
              return (light.shadow.esmBlurKernelSize = val = val ?? light.shadow.esmBlurKernelSize);
            },
            2,
            3,
            25
          );
          ImGui.DragFloat(
            'ESMBlurRadius',
            (val?: number) => {
              return (light.shadow.esmBlurRadius = val = val ?? light.shadow.esmBlurRadius);
            },
            0.1,
            0,
            20
          );
        }
      } else if (light.shadow.mode === 'vsm') {
        ImGui.DragInt(
          'VSMBlurKernelSize',
          (val?: number) => {
            return (light.shadow.vsmBlurKernelSize = val = val ?? light.shadow.vsmBlurKernelSize);
          },
          2,
          3,
          25
        );
        ImGui.DragFloat(
          'VSMBlurRadius',
          (val?: number) => {
            return (light.shadow.vsmBlurRadius = val = val ?? light.shadow.vsmBlurRadius);
          },
          0.1,
          0,
          20
        );
        ImGui.DragFloat(
          'VSMDarkness',
          (val?: number) => {
            return (light.shadow.vsmDarkness = val = val ?? light.shadow.vsmDarkness);
          },
          0.01,
          0,
          0.999
        );
      } else if (light.shadow.mode === 'pcf-pd') {
        ImGui.DragInt(
          'PoissonSampleCount',
          (val?: number) => {
            return (light.shadow.pdSampleCount = val = val ?? light.shadow.pdSampleCount);
          },
          1,
          1,
          64
        );
        ImGui.DragFloat(
          'PoissonSampleRadius',
          (val?: number) => {
            return (light.shadow.pdSampleRadius = val = val ?? light.shadow.pdSampleRadius);
          },
          0.1,
          0,
          50
        );
      } else if (light.shadow.mode === 'pcf-opt') {
        ImGui.DragInt(
          'PCFKernelSize',
          (val?: number) => {
            return (light.shadow.pcfKernelSize = val = val ?? light.shadow.pcfKernelSize);
          },
          2,
          3,
          7
        );
      }
    }
    ImGui.EndSection(1);
    ImGui.BeginSection('Light');
    const rgb = { r: light.color.x, g: light.color.y, b: light.color.z };
    if (ImGui.ColorEdit3('Color', rgb)) {
      light.color = new Vector4(rgb.r, rgb.g, rgb.b, 1);
    }
    ImGui.SliderFloat(
      'Intensity',
      (val?: number) => {
        if (val === undefined) {
          val = light.intensity;
        } else {
          light.intensity = val;
        }
        return val;
      },
      0,
      50
    );
    if (light.isPointLight() || light.isSpotLight()) {
      ImGui.SliderFloat(
        'Range',
        (val?: number) => {
          if (val === undefined) {
            val = light.range;
          } else {
            light.range = val;
          }
          return val;
        },
        0,
        50
      );
      if (light.isSpotLight()) {
        ImGui.SliderFloat(
          'Cutoff',
          (val?: number) => {
            if (val === undefined) {
              val = light.cutoff;
            } else {
              light.cutoff = val;
            }
            return val;
          },
          0,
          1
        );
      }
    }
    if (light.isDirectionLight() || light.isSpotLight()) {
      const eulerAngles = light.rotation.toEulerAngles();
      if (ImGui.SliderFloat3('Direction', eulerAngles, -Math.PI * 2, Math.PI * 2)) {
        light.rotation.fromEulerAngle(eulerAngles.x, eulerAngles.y, eulerAngles.z, 'ZYX');
      }
    }
    ImGui.EndSection(1);
  }
  private textureToListName(tex: BaseTexture) {
    return `${tex.name}(${tex.format} ${tex.width}x${tex.height}x${tex.depth})##${tex.uid}`;
  }
}
