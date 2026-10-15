import { createRecorder, isPromise } from './core.js';

/**
 * Re-export every name here so the README's import list stays honest.
 * index.js is the package entry; core.js holds the logic so it can be
 * unit-tested in isolation without pulling in a barrel file's opinion.
 */
export { createRecorder, isPromise };
