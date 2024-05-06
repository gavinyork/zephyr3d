import type { AnimationSet, Scene, SceneNode } from '@zephyr3d/scene';
import { AssetManager } from '@zephyr3d/scene';
import * as zip from '@zip.js/zip.js';

export class Character {
  private _scene: Scene;
  private _node: SceneNode;
  private _animations: AnimationSet;
  constructor(scene: Scene) {
    this._scene = scene;
    this._node = null;
    this._animations = null;
  }
  get node(): SceneNode {
    return this._node;
  }
  idle() {
    this._animations.playAnimation('idle01_yindao', 0);
  }
  runFront() {
    this._animations.playAnimation('run_front', 0);
  }
  runBack() {
    this._animations.playAnimation('run_back', 0);
  }
  runLeft() {
    this._animations.playAnimation('run_left', 0);
  }
  runRight() {
    this._animations.playAnimation('run_right', 0);
  }
  private async readZip(url: string): Promise<Map<string, string>> {
    const response = await fetch(url);
    const blob = await response.blob();
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = await reader.getEntries();
    const fileMap = new Map();
    for (const entry of entries) {
      if (!entry.directory) {
        const blob = await entry.getData(new zip.BlobWriter());
        const fileURL = URL.createObjectURL(blob);
        fileMap.set(`/${entry.filename}`, fileURL);
      }
    }
    await reader.close();
    return fileMap;
  }
  async load(): Promise<SceneNode> {
    const fileMap = await this.readZip('./assets/models/alice_shellfire.zip');
    const assetManager = new AssetManager();
    assetManager.httpRequest.urlResolver = (url) => fileMap.get(url) || url;
    const modelFile = Array.from(fileMap.keys()).find((val) => /(\.gltf|\.glb)$/i.test(val));
    const modelInfo = await assetManager.fetchModel(this._scene, modelFile);
    this._node = modelInfo.group;
    this._node.scale.setXYZ(2, 2, 2);
    this._animations = modelInfo.animationSet;
    return this._node;
  }
}
