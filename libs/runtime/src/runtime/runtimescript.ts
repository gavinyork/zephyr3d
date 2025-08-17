import type { IDisposable } from '@zephyr3d/base';

console.log('----------- import runtime script -------------');
export class RuntimeScript<T extends IDisposable | null> {
  onCreated(): void | Promise<void> {}
  onAttached(_host: T): void | Promise<void> {}
  onUpdate(_deltaTime: number, _elapsedTime: number) {}
  onDetached() {}
  onDestroy() {}
}
