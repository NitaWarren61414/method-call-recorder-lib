# method-call-recorder-lib

Proxies an object so that every method call — its arguments and its synchronous or asynchronous return — is appended to a replayable log.

```js
import { createRecorder } from 'method-call-recorder-lib';

const service = {
  add(a, b) { return a + b; },
  async fetch(id) { return { id, ok: true }; }
};

const { proxy, log } = createRecorder(service);

proxy.add(2, 3);                      // 5
await proxy.fetch(42);                // { id: 42, ok: true }

console.log(log);
// [
//   { method: 'add',  args: [2, 3], value: 5,             rejected: false },
//   { method: 'fetch', args: [42],  value: { id: 42, ok: true }, rejected: false }
// ]
```

Exports: `createRecorder(target, options?)` and `isPromise(value)`.

## Why this exists

When a service talks to the outside world, tests that exercise it tend to become slow, flaky, or network-dependent. Recording the actual method traffic — arguments and eventual return values, including rejections — yields a replayable transcript you can assert against deterministically. The trade-off: the recorder stores return values by reference, so large or mutable objects are held alive for the lifetime of the log. It is a deliberate trade for fidelity over footprint.

## The awkward edge

For asynchronous methods, a log entry is appended only once the promise settles, not at call time. That means `log` reflects **settlement order**, not call order. If two async calls are in flight and the second resolves first, the second call's entry appears first in the log. If you need call order, wait for all outstanding promises before inspecting `log`.

Only own, enumerable, function-valued properties present at the time `createRecorder` is called are recorded. Methods added to the target afterwards are passed through untouched and will not appear in the log. Property reads and writes are never recorded — this library captures method calls, not field access.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

