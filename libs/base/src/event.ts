import type { GenericConstructor, Nullable } from './utils';

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
  off<K extends keyof T>(type: K, listener?: Nullable<EventListener<T, K>>, context?: unknown): void;
  /**
   * Synchronously invoke the affected event listeners with an event object
   * @param evt - The event object to be dispatch.
   * @returns false if the event was canceled, otherwise true
   */
  dispatchEvent<K extends keyof T>(type: K, ...args: T[K]): void;
}

/**
 * Observable event emitter implementation.
 *
 * Provides subscription, one-time subscription, unsubscription, and synchronous dispatch
 * for events defined by an {@link EventMap}.
 *
 * @typeParam X - The event map describing event names and payload tuples
 * @public
 */
export class Observable<X extends EventMap> implements IEventTarget<X> {
  /** @internal */
  _listeners: Nullable<EventListenerMap<X>>;
  /**
   * Creates an {@link Observable}.
   */
  constructor() {
    this._listeners = null;
  }
  /**
   * {@inheritDoc IEventTarget.on}
   */
  on<K extends keyof X>(type: K, listener: EventListener<X, K>, context?: unknown): void {
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
  once<K extends keyof X>(type: K, listener: EventListener<X, K>, context?: unknown): void {
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
  off<K extends keyof X>(type: K, listener?: Nullable<EventListener<X, K>>, context?: unknown): void {
    if (listener) {
      this._internalRemoveEventListener(this._listeners, type, listener, context ?? null);
    }
  }
  /**
   * {@inheritDoc IEventTarget.dispatchEvent}
   */
  dispatchEvent<K extends keyof X>(type: K, ...args: X[K]): void {
    this._invokeLocalListeners(type, ...args);
  }
  /**
   * Adds an event listener to the given map.
   *
   * If the map is `null`, a new one will be created.
   *
   * @typeParam K - The event key within the event map
   * @param listenerMap - The current listener map
   * @param type - The event type to listen for
   * @param listener - The listener callback
   * @param options - Additional listener options
   * @returns The updated listener map
   * @internal
   */
  _internalAddEventListener<K extends keyof X>(
    listenerMap: Nullable<EventListenerMap<X>>,
    type: K,
    listener: EventListener<X, K>,
    options: REventHandlerOptions
  ): Nullable<EventListenerMap<X>> {
    if (typeof type !== 'string') {
      return listenerMap;
    }
    if (!listenerMap) {
      listenerMap = {};
    }
    const l: EventListener<X, K> = listener;
    const o: REventHandlerOptions = { ...options };
    let handlers = listenerMap[type];
    if (!handlers) {
      listenerMap[type] = handlers = [];
    }
    handlers.push({ handler: l, options: o, removed: false });
    return listenerMap;
  }
  /**
   * Removes an event listener from the given map.
   *
   * A listener is removed only if both the function reference and the context match.
   *
   * @typeParam K - The event key within the event map
   * @param listenerMap - The current listener map
   * @param type - The event type to remove from
   * @param listener - The listener callback to remove
   * @param context - The context object that must match the one used when adding
   * @internal
   */
  _internalRemoveEventListener<K extends keyof X>(
    listenerMap: Nullable<EventListenerMap<X>>,
    type: K,
    listener: EventListener<X, K>,
    context: unknown
  ): void {
    if (typeof type !== 'string' || !listenerMap) {
      return;
    }
    const l: EventListener<X, K> = listener;
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
  /**
   * Invokes local listeners for a given event type with the provided arguments.
   *
   * Listeners added with `once: true` are marked and pruned after invocation.
   *
   * @typeParam K - The event key within the event map
   * @param type - The event type to invoke
   * @param args - The payload to pass to each listener
   * @internal
   */
  _invokeLocalListeners<K extends keyof X>(type: keyof X, ...args: X[K]): void {
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
}

/**
 * Mixin that augments a class with {@link IEventTarget} capabilities.
 *
 * It returns a higher-order factory that, when instantiated with an event map `X`,
 * produces a subclass adding `on/once/off/dispatchEvent` and the internal listener management.
 *
 * Usage:
 * ```ts
 * class Base {}
 * const Eventful = makeObservable(Base)<{ 'ready': []; 'data': [number] }>();
 * const obj = new Eventful();
 * obj.on('data', (n) => console.log(n));
 * obj.dispatchEvent('data', 42);
 * ```
 *
 * @typeParam C - A constructor type to be extended (plain `ObjectConstructor` or a generic class)
 * @param cls - The base class to extend
 * @returns A generic factory that accepts an event map and returns an extended class
 * @public
 */
export function makeObservable<C extends GenericConstructor | ObjectConstructor>(cls: C) {
  return function _<X extends EventMap>() {
    type I = InstanceType<typeof cls> extends IEventTarget<infer U> ? X & U : X;
    return class E extends cls implements IEventTarget<I> {
      /** @internal */
      _listeners: Nullable<EventListenerMap<I>>;
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
      /**
       * Adds an event listener to the given map.
       *
       * If the map is `null`, a new one will be created.
       *
       * @typeParam K - The event key within the event map
       * @param listenerMap - The current listener map
       * @param type - The event type to listen for
       * @param listener - The listener callback
       * @param options - Additional listener options
       * @returns The updated listener map
       * @internal
       */
      _internalAddEventListener<K extends keyof I>(
        listenerMap: Nullable<EventListenerMap<I>>,
        type: K,
        listener: EventListener<I, K>,
        options: REventHandlerOptions
      ): Nullable<EventListenerMap<I>> {
        if (typeof type !== 'string') {
          return listenerMap;
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
      /**
       * Removes an event listener from the given map.
       *
       * A listener is removed only if both the function reference and the context match.
       *
       * @typeParam K - The event key within the event map
       * @param listenerMap - The current listener map
       * @param type - The event type to remove from
       * @param listener - The listener callback to remove
       * @param context - The context object that must match the one used when adding
       * @internal
       */
      _internalRemoveEventListener<K extends keyof I>(
        listenerMap: Nullable<EventListenerMap<I>>,
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
      /**
       * Invokes local listeners for a given event type with the provided arguments.
       *
       * Listeners added with `once: true` are marked and pruned after invocation.
       *
       * @typeParam K - The event key within the event map
       * @param type - The event type to invoke
       * @param args - The payload to pass to each listener
       * @internal
       */
      _invokeLocalListeners<K extends keyof I>(type: keyof I, ...args: I[K]): void {
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
