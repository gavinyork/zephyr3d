/** A texture and the resolved descriptor it satisfied in the previous execution. */
interface RGTextureAffinityEntry<TTexture> {
  texture: TTexture;
  descriptorSignature: string;
}

/**
 * Stores the last successful transient texture allocation for each logical
 * render-graph resource. The cache does not own or retain the textures.
 *
 * Keep one cache per independently executed render view. Passing the same cache
 * to newly-created executors lets pooled physical texture identities remain
 * stable across frames.
 *
 * @public
 */
export class RGTextureAffinityCache<TTexture = unknown> {
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
