import { animationFrames, lastValueFrom } from 'rxjs';
import { finalize, takeWhile, map, tap } from 'rxjs/operators';

import { Gpu } from '../../graphics';

export type SampleGetter<T> = () => T;

export enum SampleStatus {
  Pending = 0,
  Complete = 1,
  Timeout = 2,
}

export class Sample<T> {
  private sync: WebGLSync;
  private readonly birthtime: number;

  constructor(
    private readonly gpu: Gpu,
    private readonly getter: SampleGetter<T>,
    private readonly lifetime = 1000
  ) {
    this.sync = this.createSync();
    this.birthtime = performance.now();
  }

  status(): SampleStatus {
    if (this.birthtime + this.lifetime >= performance.now()) {
      let result: GLenum = this.gpu.context.getSyncParameter(
        this.sync,
        WebGL2RenderingContext.SYNC_STATUS
      );
      return result === WebGL2RenderingContext.UNSIGNALED
        ? SampleStatus.Pending
        : SampleStatus.Complete;
    } else {
      return SampleStatus.Timeout;
    }
  }

  outcome(): T {
    return this.getter();
  }

  release(): void {
    if (this.sync) {
      this.gpu.context.deleteSync(this.sync);
      this.sync = null;
    }
  }

  toPromise(): Promise<T> {
    return lastValueFrom(
      animationFrames().pipe(
        map(() => this.status()),
        tap((status) => {
          if (status === SampleStatus.Timeout) {
            throw new Error('OceanFieldSample: timeout expired');
          }
        }),
        takeWhile((status) => status === SampleStatus.Pending, true),
        map((status) =>
          status === SampleStatus.Complete ? this.outcome() : null
        ),
        finalize(() => this.release())
      )
    );
  }

  private createSync() {
    return this.gpu.context.fenceSync(
      WebGL2RenderingContext.SYNC_GPU_COMMANDS_COMPLETE,
      0
    );
  }
}
