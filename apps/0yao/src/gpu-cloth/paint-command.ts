import type { SceneNode } from '@zephyr3d/scene';

type CommandLike<T = void> = {
  execute(): Promise<T>;
  undo(): Promise<void>;
};

export type ClothWeightState = {
  vertexPinWeightsByTarget: string;
  pinnedVertexIndicesByTarget: string;
};

function cloneClothWeightState(state: ClothWeightState): ClothWeightState {
  return {
    vertexPinWeightsByTarget: state?.vertexPinWeightsByTarget ?? '',
    pinnedVertexIndicesByTarget: state?.pinnedVertexIndicesByTarget ?? ''
  };
}

function findNodeByPath(root: SceneNode, path: string): SceneNode | null {
  const parts = path.split('/').filter((p) => !!p);
  let current: SceneNode = root;
  for (const part of parts) {
    const next = current.children.find((node) => node.persistentId === part) ?? null;
    if (!next) {
      return null;
    }
    current = next;
  }
  return current;
}

function getNodePath(node: SceneNode) {
  const parts: string[] = [];
  const root = node.scene!.rootNode;
  while (node && node !== root) {
    parts.unshift(node.persistentId);
    node = node.parent!;
  }
  return parts.join('/');
}

export class ClothWeightPaintCommand implements CommandLike {
  private readonly _sceneRoot: SceneNode;
  private readonly _hostId: string;
  private readonly _oldState: ClothWeightState;
  private readonly _newState: ClothWeightState;
  private readonly _desc: string;

  constructor(
    host: SceneNode,
    oldState: ClothWeightState,
    newState: ClothWeightState,
    desc = 'Paint cloth weights'
  ) {
    this._sceneRoot = host.scene!.rootNode;
    this._hostId = getNodePath(host);
    this._oldState = cloneClothWeightState(oldState);
    this._newState = cloneClothWeightState(newState);
    this._desc = desc;
  }

  getDesc() {
    return this._desc;
  }

  async execute() {
    this.apply(this._newState);
  }

  async undo() {
    this.apply(this._oldState);
  }

  private apply(state: ClothWeightState) {
    const host = findNodeByPath(this._sceneRoot, this._hostId);
    if (!host) {
      return;
    }
    const config = ((host as any).scriptConfig ??= {}) as {
      vertexPinWeightsByTarget?: string;
      pinnedVertexIndicesByTarget?: string;
    };
    config.vertexPinWeightsByTarget = state.vertexPinWeightsByTarget ?? '';
    config.pinnedVertexIndicesByTarget = state.pinnedVertexIndicesByTarget ?? '';
  }
}
