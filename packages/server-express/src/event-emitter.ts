/**
 * Minimal typed event emitter for paywall lifecycle events.
 *
 * Listeners are invoked asynchronously (via `queueMicrotask`) so they never
 * block the HTTP response path.  Errors thrown inside listeners are caught and
 * forwarded to any registered `'error'` handler, or silently swallowed if none
 * exists — matching the Node `EventEmitter` safety contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<TEvents extends Record<string, any>> {
  private listeners = new Map<keyof TEvents, Set<(data: never) => void>>();
  private errorHandler: ((err: unknown) => void) | null = null;

  /**
   * Register a listener for the given event.
   * Returns `this` for chaining.
   */
  on<K extends keyof TEvents>(event: K, listener: (data: TEvents[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (data: never) => void);
    return this;
  }

  /**
   * Remove a previously registered listener.
   * Returns `this` for chaining.
   */
  off<K extends keyof TEvents>(event: K, listener: (data: TEvents[K]) => void): this {
    this.listeners.get(event)?.delete(listener as (data: never) => void);
    return this;
  }

  /**
   * Register a handler for errors thrown inside listeners.
   * If no error handler is set, listener errors are silently ignored.
   */
  onError(handler: (err: unknown) => void): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * Emit an event.  All registered listeners are called asynchronously via
   * `queueMicrotask` so that the caller is never blocked.
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    for (const listener of set) {
      queueMicrotask(() => {
        try {
          (listener as (data: TEvents[K]) => void)(data);
        } catch (err: unknown) {
          if (this.errorHandler) {
            try {
              this.errorHandler(err);
            } catch {
              // Prevent infinite loops — swallow error-handler errors.
            }
          }
        }
      });
    }
  }

  /** Remove all listeners, optionally scoped to a single event. */
  removeAllListeners(event?: keyof TEvents): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}
