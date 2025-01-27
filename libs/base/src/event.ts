import type { GenericConstructor } from './utils';

/**
 * Mapping table of event types and their constructors
 * @public
 */
export type EventMap = Record<string, any[]>;

/**
 * Event handler type
 * @public
 */
export type EventListener<T extends EventMap, K extends keyof T> = (...args: T[K]) => void | Promise<void>;

/**
 * Options of event handler
 * @public
 */
export type REventHandlerOptions = {
  once: boolean;
  context: unknown;
};

type EventListenerMap<T extends EventMap> = {
  [K in keyof T]?: {
    handler: EventListener<T, K>;
    options: REventHandlerOptions;
    removed: boolean;
  }[];
};

/**
 * The event target interface
 * @public
 */
export interface IEventTarget<T extends EventMap = any> {
  /**
   * Sets up a function that will be called whenever the specified event is delivered to the target
   * @param type - The event type to listen for
   * @param listener - The callback function
   * @param context - Context object of the listener function
   */
  on<K extends keyof T>(type: K, listener: EventListener<T, K>, context?: unknown): void;
  /**
   * Sets up a function that will be called only once when the specified event is delivered to the target
   * @param type - The event type to listen for
   * @param listener - The callback function
   * @param context - Context object of the listener function
   */
  once<K extends keyof T>(type: K, listener: EventListener<T, K>, context?: unknown): void;
  /**
   * Removes an event listener function previously registered.
   * @param type - The event type for which to remove an event listener
   * @param listener - The callback function to be removed
   */
  off<K extends keyof T>(type: K, listener: EventListener<T, K>, context?: unknown): void;
  /**
   * Synchronously invoke the affected event listeners with an event object
   * @param evt - The event object to be dispatch.
   * @returns false if the event was canceled, otherwise true
   */
  dispatchEvent<K extends keyof T>(type: K, ...args: T[K]): void;
}

/**
 * This mixin make a class an event target
 * @param cls - the class to make
 * @returns - The event target class
 * @public
 */
export function makeEventTarget<C extends GenericConstructor | ObjectConstructor>(cls: C) {
  return function _<X extends EventMap>() {
    type I = InstanceType<typeof cls> extends IEventTarget<infer U> ? X & U : X;
    return class E extends cls implements IEventTarget<I> {
      /** @internal */
      _listeners: EventListenerMap<I>;
      constructor(...args: any[]) {
        super(...args);
        this._listeners = null;
      }
      /**
       * {@inheritDoc IEventTarget.on}
       */
      on<K extends keyof I>(type: K, listener: EventListener<I, K>, context?: unknown): void {
        if (listener) {
          this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
            context: context ?? null,
            once: false
          });
        } else {
          console.error('Cannot set NULL listener');
        }
      }
      /**
       * {@inheritDoc IEventTarget.once}
       */
      once<K extends keyof I>(type: K, listener: EventListener<I, K>, context?: unknown): void {
        if (listener) {
          this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
            context: context ?? null,
            once: true
          });
        } else {
          console.error('Cannot set NULL listener');
        }
      }
      /**
       * {@inheritDoc IEventTarget.off}
       */
      off<K extends keyof I>(type: K, listener: EventListener<I, K>, context?: unknown): void {
        this._internalRemoveEventListener(this._listeners, type, listener, context ?? null);
      }
      /**
       * {@inheritDoc IEventTarget.dispatchEvent}
       */
      dispatchEvent<K extends keyof I>(type: K, ...args: I[K]): void {
        this._invokeLocalListeners(type, ...args);
      }
      /** @internal */
      _internalAddEventListener<K extends keyof I>(
        listenerMap: EventListenerMap<I>,
        type: K,
        listener: EventListener<I, K>,
        options: REventHandlerOptions
      ): EventListenerMap<I> {
        if (typeof type !== 'string') {
          return;
        }
        if (!listenerMap) {
          listenerMap = {};
        }
        const l: EventListener<I, K> = listener;
        const o: REventHandlerOptions = { ...options };
        let handlers = listenerMap[type];
        if (!handlers) {
          listenerMap[type] = handlers = [];
        }
        handlers.push({ handler: l, options: o, removed: false });
        return listenerMap;
      }
      /** @internal */
      _internalRemoveEventListener<K extends keyof I>(
        listenerMap: EventListenerMap<I>,
        type: K,
        listener: EventListener<I, K>,
        context: unknown
      ): void {
        if (typeof type !== 'string' || !listenerMap) {
          return;
        }
        const l: EventListener<I, K> = listener;
        const handlers = listenerMap[type];
        if (handlers) {
          for (let i = 0; i < handlers.length; i++) {
            const handler = handlers[i];
            if (handler.handler === l && handler.options.context === context) {
              handlers.splice(i, 1);
              break;
            }
          }
          if (handlers.length === 0) {
            listenerMap[type] = undefined;
          }
        }
      }
      /** @internal */
      _invokeLocalListeners<K extends keyof I>(type: keyof I, ...args: I[K]) {
        if (!this._listeners) {
          return;
        }
        const handlers = this._listeners[type];
        if (handlers && handlers.length > 0) {
          const handlersCopy = handlers.slice();
          for (const handler of handlersCopy) {
            handler.handler.call(handler.options?.context || this, ...args);
            if (handler.options.once) {
              handler.removed = true;
            }
          }
          for (let i = handlers.length - 1; i >= 0; i--) {
            if (handlers[i].removed) {
              handlers.splice(i, 1);
            }
          }
        }
      }
    };
  };
}
