/**
 * Detect a thenable without relying on instanceof Promise.
 *
 * Why: cross-realm objects (e.g. from a VM context) have a different
 * Promise constructor, so `instanceof Promise` is unreliable. We use
 * a structural duck-type on `.then` instead, which is the only thing
 * the await protocol actually inspects.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isPromise(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  );
}

/**
 * Sentinel used to mark a log entry that carries a rejection.
 * Using a distinct object (rather than a string like 'error') means a
 * method can legitimately resolve with the string "error" without us
 * misclassifying it as a failure during replay or inspection.
 */
const REJECTION = Symbol('method-call-recorder.rejection');

/**
 * Wrap a target object so every method invocation is appended to a
 * replayable log.
 *
 * Design decisions, stated plainly:
 *
 * 1. Synchronous and asynchronous returns are both recorded. An async
 *    return is logged only after the promise settles, and the log entry
 *    carries the eventual value (or error). This means the log is not in
 *    call order for async methods — it is in settlement order. If you
 *    need strict call order, record `recorder.log` only after all
 *    promises have settled.
 *
 * 2. Only own, enumerable, function-valued properties of the target are
 *    proxied. Accessor properties and the prototype chain are passed
 *    through untouched. This keeps the recorder predictable and avoids
 *    silently double-wrapping inherited methods.
 *
 * 3. Non-function properties are forwarded to the target via a Proxy get
 *    trap, so reads still see live target data. Writes go straight to
 *    the target. We deliberately do not log property access — the
 *    library records method *calls*, not field reads.
 *
 * 4. Rejection values are stored by value, not wrapped. If the target's
 *    rejection is an Error, we keep that Error object. Callers can
 *    distinguish settled rejections from settled resolutions via
 *    `entry.rejected`.
 *
 * @param {object} target - the object whose methods will be recorded
 * @param {object} [options]
 * @param {object} [options.store] - a push-only array-like with a
 *   `push(item)` method; defaults to a fresh Array. Exposed so tests
 *   can pass their own collection.
 * @returns {{ proxy: object, log: Array }} `proxy` is the instrumented
 *   object; `log` is the array of recorded entries.
 */
export function createRecorder(target, options = {}) {
  if (target === null || typeof target !== 'object') {
    throw new TypeError('createRecorder expects an object target');
  }

  const store =
    options && options.store !== undefined ? options.store : [];

  if (!store || typeof store.push !== 'function') {
    throw new TypeError('options.store must provide a push(item) method');
  }

  const log = store;

  // Capture the set of own enumerable method names once, up front, so
  // later mutations to the target's shape do not silently introduce
  // un-recorded methods. This trades dynamism for a clear invariant:
  // the set of recorded methods is fixed at creation time.
  const methodNames = Object.keys(target).filter(
    (key) => typeof target[key] === 'function'
  );

  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);

      if (methodNames.includes(prop) && typeof value === 'function') {
        // Return a bound wrapper so `proxy.method()` and
        // `const m = proxy.method; m()` both record the same call.
        return function (...args) {
          let result;
          try {
            result = Reflect.apply(value, t, args);
          } catch (syncError) {
            log.push({
              method: prop,
              args,
              rejected: true,
              value: syncError
            });
            throw syncError;
          }

          if (isPromise(result)) {
            // Return a new promise that preserves the original's
            // settlement value while logging once it resolves or
            // rejects. We do NOT mutate the caller's promise.
            return result.then(
              (resolved) => {
                log.push({ method: prop, args, rejected: false, value: resolved });
                return resolved;
              },
              (rejection) => {
                log.push({
                  method: prop,
                  args,
                  rejected: true,
                  value: rejection
                });
                throw rejection;
              }
            );
          }

          log.push({ method: prop, args, rejected: false, value: result });
          return result;
        };
      }

      return value;
    }
  });

  return { proxy, log };
}
