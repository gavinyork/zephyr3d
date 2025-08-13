/**
 * ScriptRegistry 基类
 * - 负责模块定位、源码读取、转译与导入重写等策略的抽象
 * - 子类可根据环境实现：VFS 文件系统（editor）或 URL/服务器（runtime）
 *
 * 约定：
 * - ModuleId：逻辑模块标识（通常不包含扩展名），例如 "/scripts/foo/bar"
 * - resolveUrl：返回可以被原生 import() 加载的 URL（runtime 模式）
 * - fetchSource/transpile/rewriteImports：用于编辑器模式的构建流程
 */

import type { ModuleId } from './types';

export interface RegistryOptions {
  mode: 'editor' | 'runtime' | string;
}

export abstract class ScriptRegistry {
  public readonly opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.opts = opts;
  }

  /**
   * runtime 模式下：把逻辑 ModuleId 映射为可被 import() 的真实 URL
   * editor 模式：通常不使用此函数（返回空字符串或抛错均可），由子类自行决定
   */
  async resolveUrl(id: ModuleId): Promise<string> {
    const u = await this.resolveRuntimeUrl(id);
    if (!u) {
      throw new Error(`resolveUrl not implemented for id: ${id}`);
    }
    return u;
  }

  protected abstract resolveRuntimeUrl(id: ModuleId): Promise<string>;

  /**
   * editor 模式下：读取源代码。若找不到返回 undefined
   * - 子类需要按自己的存储介质实现（如 VFS 或网络）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async fetchSource(
    _id: ModuleId
  ): Promise<{ code: string; path: string; type: 'js' | 'ts'; sourceMap?: string } | undefined> {
    return undefined;
  }

  /**
   * editor 模式下：转译 TS/新语法为 JS（默认直返）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async transpile(code: string, _id: ModuleId, _type: 'js' | 'ts'): Promise<string> {
    return code;
  }

  /**
   * editor 模式下：重写 import 路径以便加载（默认直返）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async rewriteImports(code: string, _fromId: ModuleId): Promise<string> {
    return code;
  }

  /**
   * editor 模式下（可选）：提供统一执行入口。
   * - base 类不实现，由子类（如 VFSScriptRegistry）在 editor 模式下借助 SystemJS 或其他机制实现
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async run(_entryId: ModuleId): Promise<any> {
    throw new Error('run() not implemented by this registry');
  }
}

export default ScriptRegistry;
