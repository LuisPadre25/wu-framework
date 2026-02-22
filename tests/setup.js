/**
 * Vitest global setup - polyfill Storage for jsdom environments
 * where window.localStorage/sessionStorage lack standard methods.
 */

function createMemoryStorage() {
  let store = {};
  return {
    getItem(key) {
      return key in store ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      store = {};
    },
    key(index) {
      const keys = Object.keys(store);
      return index < keys.length ? keys[index] : null;
    },
    get length() {
      return Object.keys(store).length;
    }
  };
}

// Only polyfill if the existing localStorage is broken
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.setItem !== 'function') {
  const ls = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true, configurable: true });
}
if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage?.setItem !== 'function') {
  const ss = createMemoryStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { value: ss, writable: true, configurable: true });
}
