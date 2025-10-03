import { ZipFS } from '@zephyr3d/base';
import type { AnimationSet, Scene, SceneNode } from '@zephyr3d/scene';
import { AssetManager, SerializationManager } from '@zephyr3d/scene';
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
    this._animations.playAnimation('idle01_yindao');
  }
  runFront() {
    this._animations.playAnimation('run_front');
  }
  runBack() {
    this._animations.playAnimation('run_back');
  }
  runLeft() {
    this._animations.playAnimation('run_left');
  }
  runRight() {
    this._animations.playAnimation('run_right');
  }
  async load(): Promise<SceneNode> {
    const zipFS = new ZipFS(zip);
    const content = await (
      await fetch('https://cdn.zephyr3d.org/doc/assets/models/alice_shellfire.zip')
    ).arrayBuffer();
    await zipFS.initializeFromData(content);
    const assetManager = new AssetManager(new SerializationManager(zipFS));
    const modelFiles = await zipFS.glob('**/*.{gltf,glb}');
    if (modelFiles.length === 0) {
      throw new Error('No glTF model found in zip');
    }
    const modelFile = modelFiles[0].path;
    const modelInfo = await assetManager.fetchModel(this._scene, modelFile);
    this._node = modelInfo.group;
    this._node.scale.setXYZ(2, 2, 2);
    this._animations = modelInfo.animationSet;
    return this._node;
  }
}
