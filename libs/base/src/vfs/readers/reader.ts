import type { FileMetadata } from '../vfs';

/**
 * Context utilities provided to an {@link HttpDirectoryReader}.
 *
 * A reader implementation uses these helpers to fetch remote resources,
 * resolve/normalize paths, and infer MIME types without depending on the VFS internals.
 *
 * @public
 */
export interface HttpDirectoryReaderContext {
  /**
   * Fetch helper with the same signature as `window.fetch`, usually wrapped
   * with timeouts/headers/credentials by the hosting VFS.
   *
   * Implementations should use this instead of calling `fetch` directly.
   *
   * @param url - Absolute URL or path to fetch.
   * @param init - Optional fetch initialization options.
   * @returns A promise that resolves to the HTTP response.
   */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Converts a VFS path to an absolute URL that can be fetched.
   *
   * Data URIs and object URLs should pass through unchanged.
   *
   * @param path - VFS path or URL-like string.
   * @returns An absolute URL string.
   */
  toURL: (path: string) => string;
  /**
   * Normalizes a VFS path into canonical form.
   *
   * Readers should use this to sanitize incoming paths and to build stable
   * `FileMetadata.path` values.
   *
   * @param path - Input path.
   * @returns Normalized path (typically absolute, POSIX style).
   */
  normalizePath: (path: string) => string;
  /**
   * Joins multiple path segments and normalizes the result.
   *
   * @param parts - Path segments in order.
   * @returns A normalized joined path.
   */
  joinPath: (...parts: string[]) => string;
  /**
   * Best-effort MIME type inference based on a file name or path.
   *
   * @param name - File name or full path.
   * @returns A MIME type string if known, otherwise `undefined`.
   */
  guessMimeType: (name: string) => string | undefined;
}

/**
 * Interface for an HTTP directory reader.
 *
 * Implementations encapsulate the logic to enumerate entries under an HTTP-served
 * directory. This may involve parsing HTML indexes, JSON manifests, or custom APIs.
 *
 * Notes:
 * - A host VFS may register multiple readers and select one via {@link canHandle}.
 * - Readers should return a flat list of entries for the provided `dirPath` only
 *   (non-recursive). Recursion is orchestrated by the VFS if needed.
 *
 * @public
 */
export interface HttpDirectoryReader {
  /**
   * Human-readable name of this reader implementation (for diagnostics/logging).
   */
  readonly name: string;
  /**
   * Optional probe that indicates whether this reader can handle the given directory.
   *
   * Typical strategies:
   * - Check for a known index file (e.g., "index.json")
   * - HEAD/GET and inspect headers/content patterns
   *
   * If omitted, the host may assume the reader can handle all directories.
   *
   * @param dirPath - Normalized directory path (typically ends with "/").
   * @param ctx - Context utilities for fetching and path handling.
   * @returns `true` if supported, otherwise `false`. May return a promise.
   */
  canHandle?(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<boolean> | boolean;
  /**
   * Performs a single-pass listing of the directory at `dirPath`.
   *
   * Requirements:
   * - Return only direct children of `dirPath` (non-recursive).
   * - Populate `FileMetadata` fields as accurately as possible (name, path, type, size, timestamps, mimeType).
   * - Use `ctx.normalizePath`/`ctx.joinPath` to build stable `path` fields.
   *
   * Error handling:
   * - Throw on unrecoverable errors (the host VFS may fall back to other readers).
   * - Return an empty array if the directory is valid but contains no entries.
   *
   * @param dirPath - Normalized directory path to read (typically ends with "/").
   * @param ctx - Context utilities for network and path operations.
   * @returns A promise resolving to a flat list of file/directory metadata.
   */
  readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]>;
}
