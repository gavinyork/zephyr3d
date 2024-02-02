import { glMatrix, vec3 } from 'gl-matrix';
import { firstValueFrom, fromEvent, Observable, race, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import {
  createDisc,
  createGrid,
  createNDCGrid,
  createPlane,
  createQuad,
} from '../graphics';

export interface ThreadWorkerProcedure<I, O> {
  (input: I): O;
}

export class ThreadWorker<I = unknown, O = unknown> {
  private static readonly globals = new Map<string, string>();
  private readonly thread: Worker;
  private readonly message$: Observable<O>;
  private readonly error$: Observable<any>;

  constructor(private readonly procedure: ThreadWorkerProcedure<I, O>) {
    this.thread = this.createThread();
    this.message$ = fromEvent<MessageEvent<O>>(this.thread, 'message').pipe(
      map((m) => m.data)
    );
    this.error$ = fromEvent(this.thread, 'error').pipe(
      switchMap((e) => throwError(() => e))
    );
  }

  public static registerGlobal<T>(name: string, value: T) {
    const isFunction = (value: any): value is Function =>
      typeof value === 'function';
    const isNative = (fn: Function) => /\[native code\]/.test(fn.toString());
    const replacer = (key: string, value: any) => {
      if (isFunction(value)) {
        if (isNative(value)) {
          return `<<${value.name}>>`;
        }
        return `<<${value}>>`;
      }
      return value;
    };
    const escape = (str: string) =>
      str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\/g, '')
        .replace(/["']<<|>>['"]/g, '');

    const expr = escape(JSON.stringify(value, replacer, 2));
    this.globals.set(name, expr);
  }

  public process(input: I): Promise<O> {
    this.thread.postMessage(input);
    return firstValueFrom(race(this.message$, this.error$));
  }

  public release(): void {
    this.thread.terminate();
  }

  private createThread() {
    const globals = Array.from(ThreadWorker.globals.entries())
      .map(([name, fn]) => `const ${name} = ${fn.toString()}`)
      .join(';\n');
    const fn = this.procedure.toString();

    const content = `${globals};
      self.addEventListener('message', (e) => {
        try {
          const result = (${fn})(e.data);
          self.postMessage(result);
        } catch (e) {
          console.warn('ThreadWorker: ', e);
        }
      });
    `;
    const blob = new Blob([content], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    return new Worker(url);
  }
}

export const registerWorkerGlobals = () => {
  ThreadWorker.registerGlobal('glMatrix', {
    ...glMatrix,
    RANDOM: () => Math.random(),
  });
  ThreadWorker.registerGlobal('ARRAY_TYPE', Float32Array);
  ThreadWorker.registerGlobal('vec3', vec3);
  ThreadWorker.registerGlobal('createGrid', createGrid);
  ThreadWorker.registerGlobal('createQuad', createQuad);
  ThreadWorker.registerGlobal('createPlane', createPlane);
  ThreadWorker.registerGlobal('createDisc', createDisc);
  ThreadWorker.registerGlobal('createNDCGrid', createNDCGrid);
};
