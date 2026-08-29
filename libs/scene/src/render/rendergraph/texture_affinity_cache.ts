import type { BaseTexture } from '@zephyr3d/device';

/** A texture and the resolved descriptor it satisfied in the previous execution. */
interface RGTextureAffinityEntry<TTexture> {
  texture: TTexture;
  descriptorSignature: string;
}

/** Remembers transient texture identities across executions without owning them. @public */
export class RGTextureAffinityCache<TTexture = BaseTexture> {
  /** @internal */
  private _entries = new Map<string, RGTextureAffinityEntry<TTexture>>();

  /** Number of logical resources remembered from the last successful execution. */
  get size(): number {
    return this._entries.size;
  }

  /** Remove all remembered allocations without releasing the referenced textures. */
  clear(): void {
    this._entries.clear();
  }

  /** @internal */
  getPreferredTexture(allocationKey: string, descriptorSignature: string): TTexture | undefined {
    const entry = this._entries.get(allocationKey);
    return entry?.descriptorSignature === descriptorSignature ? entry.texture : undefined;
  }

  /** @internal */
  replace(entries: ReadonlyMap<string, RGTextureAffinityEntry<TTexture>>): void {
    this._entries = new Map(entries);
  }
}

/** @internal */
export type { RGTextureAffinityEntry };
