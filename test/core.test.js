import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, isPromise } from '../src/core.js';

/**
 * Promise.delay is not available in every Node version we target, so
 * we build a tiny resolving promise inline. Never use wall-clock
 * timeouts for assertions.
 */
function resolved(value) {
  return Promise.resolve(value);
}

function rejected(value) {
  return Promise.reject(value);
}

describe('isPromise', () => {
  it('returns false for null and primitives', () => {
    assert.equal(isPromise(null), false);
    assert.equal(isPromise(undefined), false);
    assert.equal(isPromise(42), false);
    assert.equal(isPromise('hello'), false);
    assert.equal(isPromise(true), false);
  });

  it('returns false for plain objects without a then method', () => {
    assert.equal(isPromise({}), false);
    assert.equal(isPromise({ catch: () => {} }), false);
  });

  it('returns true for real Promises and thenable duck-types', () => {
    assert.equal(isPromise(Promise.resolve(1)), true);
    assert.equal(isPromise({ then: () => {} }), true);
  });
});

describe('createRecorder', () => {
  it('throws on a non-object target', () => {
    assert.throws(() => createRecorder(null), TypeError);
    assert.throws(() => createRecorder('nope'), TypeError);
  });

  it('throws when store lacks a push method', () => {
    assert.throws(() => createRecorder({}, { store: {} }), TypeError);
  });

  let target;
  let recorder;
  beforeEach(() => {
    target = {
      add(a, b) {
        return a + b;
      },
      greet(name) {
        return `hello, ${name}`;
      },
      count: 0
    };
    recorder = createRecorder(target);
  });

  it('records a sync call with method, args, value, and rejected=false', () => {
    const out = recorder.proxy.add(2, 3);
    assert.equal(out, 5);
    assert.equal(recorder.log.length, 1);
    assert.deepEqual(recorder.log[0], {
      method: 'add',
      args: [2, 3],
      value: 5,
      rejected: false
    });
  });

  it('records multiple sync calls in call order', () => {
    recorder.proxy.add(1, 1);
    recorder.proxy.greet('world');
    assert.deepEqual(
      recorder.log.map((e) => e.method),
      ['add', 'greet']
    );
  });

  it('passes through reads and writes of non-function properties', () => {
    assert.equal(recorder.proxy.count, 0);
    recorder.proxy.count = 9;
    assert.equal(target.count, 9);
    assert.equal(recorder.log.length, 0);
  });

  it('records an async resolution once the promise settles', async () => {
    target.async = (n) => resolved(n * 2);
    const { proxy, log } = createRecorder(target);
    const out = proxy.async(21);
    assert.equal(isPromise(out), true);
    assert.equal(log.length, 0);
    const value = await out;
    assert.equal(value, 42);
    assert.equal(log.length, 1);
    assert.deepEqual(log[0], {
      method: 'async',
      args: [21],
      value: 42,
      rejected: false
    });
  });

  it('records an async rejection and re-throws the original value', async () => {
    const boom = new Error('boom');
    target.fails = () => rejected(boom);
    const { proxy, log } = createRecorder(target);
    await assert.rejects(() => proxy.fails());
    assert.equal(log.length, 1);
    assert.equal(log[0].rejected, true);
    assert.equal(log[0].value, boom);
  });

  it('records a synchronous throw with rejected=true and re-throws', () => {
    const target2 = {
      broken() {
        throw new Error('nope');
      }
    };
    const { proxy, log } = createRecorder(target2);
    assert.throws(() => proxy.broken(), /nope/);
    assert.equal(log.length, 1);
    assert.equal(log[0].method, 'broken');
    assert.equal(log[0].rejected, true);
    assert.ok(log[0].value instanceof Error);
  });

  it('preserves the `this` binding of recorded methods', () => {
    const counter = {
      _n: 0,
      tick() {
        this._n += 1;
        return this._n;
      }
    };
    const { proxy } = createRecorder(counter);
    assert.equal(proxy.tick(), 1);
    assert.equal(proxy.tick(), 2);
  });

  it('does not record methods added after the recorder was created', () => {
    const { proxy, log } = createRecorder(target);
    target.late = () => 'late';
    const out = proxy.late();
    assert.equal(out, 'late');
    assert.equal(log.length, 0);
  });

  it('honours a custom store with a push method', () => {
    const received = [];
    const store = { push: (item) => received.push(item) };
    const { proxy, log } = createRecorder({ sq: (x) => x * x }, { store });
    proxy.sq(4);
    assert.equal(log, store);
    assert.equal(received.length, 1);
    assert.equal(received[0].value, 16);
  });

  it('does not mutate the original promise object', async () => {
    let original;
    target.captures = () => {
      original = resolved('ok');
      return original;
    };
    const { proxy, log } = createRecorder(target);
    const returned = proxy.captures();
    assert.equal(isPromise(returned), true);
    assert.notEqual(returned, original);
    await returned;
    assert.equal(log[0].value, 'ok');
  });
});
