/**
 * WU-PROXY-SANDBOX: Hardened JavaScript Isolation
 *
 * ES6 Proxy-based sandbox with side-effect tracking:
 * - Timer hijacking (setTimeout, setInterval, requestAnimationFrame)
 * - Event listener tracking (window + document addEventListener)
 * - DOM scoping (querySelector/querySelectorAll → shadow root)
 * - Storage scoping (localStorage/sessionStorage → prefixed keys)
 *
 * All tracked side effects are automatically cleaned up on deactivate().
 */

import { logger } from './wu-logger.js';

export class WuProxySandbox {
  constructor(appName) {
    this.appName = appName;
    this.proxy = null;
    this.fakeWindow = Object.create(null);
    this.active = false;
    this.modifiedKeys = new Set();

    // --- Side-effect tracking ---
    this._timers = new Set();
    this._intervals = new Set();
    this._rafs = new Set();
    this._eventListeners = []; // [{target, event, handler, options}]

    // --- DOM & Storage scoping ---
    this._container = null;
    this._shadowRoot = null;
    this._scopedDocument = null;
    this._scopedLocalStorage = null;
    this._scopedSessionStorage = null;

    // --- Window patching state ---
    this._patched = false;
    this._originals = null;
  }

  /**
   * Set the DOM scope for this sandbox.
   * Must be called before activate() for DOM scoping to work.
   * @param {HTMLElement} container - App container element
   * @param {ShadowRoot} shadowRoot - Shadow root containing the container
   */
  setContainer(container, shadowRoot) {
    this._container = container;
    this._shadowRoot = shadowRoot;
  }

  /**
   * Activate the sandbox. Creates the Proxy and starts tracking.
   * @returns {Proxy} The sandboxed window proxy
   */
  activate() {
    if (this.active) return this.proxy;

    const self = this;

    this.proxy = new Proxy(window, {
      get(target, prop) {
        // 1. App's own isolated globals
        if (prop in self.fakeWindow) {
          return self.fakeWindow[prop];
        }

        // 2. Intercepted APIs
        const intercepted = self._intercept(prop, target);
        if (intercepted !== undefined) {
          return intercepted;
        }

        // 3. Real window value with correct binding
        const value = target[prop];
        if (typeof value === 'function' && !self._isConstructor(value)) {
          return value.bind(target);
        }
        return value;
      },

      set(target, prop, value) {
        self.fakeWindow[prop] = value;
        self.modifiedKeys.add(prop);
        return true;
      },

      has(target, prop) {
        return prop in self.fakeWindow || prop in target;
      },

      deleteProperty(target, prop) {
        if (prop in self.fakeWindow) {
          delete self.fakeWindow[prop];
          self.modifiedKeys.delete(prop);
          return true;
        }
        return false;
      }
    });

    this.active = true;
    logger.wuDebug(`[ProxySandbox] Activated for ${this.appName}`);
    return this.proxy;
  }

  /**
   * Deactivate the sandbox. Cleans up ALL tracked side effects.
   */
  deactivate() {
    if (!this.active) return;

    // Unpatch window if patched
    this.unpatchWindow();

    // --- Clean timers ---
    for (const id of this._timers) {
      try { clearTimeout(id); } catch {}
    }
    for (const id of this._intervals) {
      try { clearInterval(id); } catch {}
    }
    for (const id of this._rafs) {
      try { cancelAnimationFrame(id); } catch {}
    }

    const timerCount = this._timers.size + this._intervals.size + this._rafs.size;
    this._timers.clear();
    this._intervals.clear();
    this._rafs.clear();

    // --- Clean event listeners ---
    const listenerCount = this._eventListeners.length;
    for (const { target, event, handler, options } of this._eventListeners) {
      try { target.removeEventListener(event, handler, options); } catch {}
    }
    this._eventListeners = [];

    // --- Clean namespace ---
    this.fakeWindow = Object.create(null);
    this.modifiedKeys.clear();
    this._scopedDocument = null;
    this._scopedLocalStorage = null;
    this._scopedSessionStorage = null;
    this.proxy = null;
    this.active = false;

    if (timerCount > 0 || listenerCount > 0) {
      logger.wuDebug(
        `[ProxySandbox] ${this.appName} cleanup: ${timerCount} timers, ${listenerCount} listeners`
      );
    }
    logger.wuDebug(`[ProxySandbox] Deactivated for ${this.appName}`);
  }

  // ================================================================
  // WINDOW PATCHING - patches real window APIs during module loading
  // ================================================================

  /**
   * Patch real window APIs to track side effects from global code.
   * Call before loading app module, unpatch after.
   *
   * IMPORTANT: Uses closure over originals so patched functions remain
   * valid even after unpatchWindow() — prevents crashes when frameworks
   * (React 19, etc.) cache references to patched setTimeout during import.
   */
  patchWindow() {
    if (this._patched) return;

    const self = this;

    // Capture originals in a local closure that survives unpatch
    const originals = {
      setTimeout: window.setTimeout,
      clearTimeout: window.clearTimeout,
      setInterval: window.setInterval,
      clearInterval: window.clearInterval,
      requestAnimationFrame: window.requestAnimationFrame,
      cancelAnimationFrame: window.cancelAnimationFrame,
      addEventListener: window.addEventListener,
      removeEventListener: window.removeEventListener
    };

    // Store reference (used by unpatchWindow to restore)
    this._originals = originals;

    // Patch timers — closure captures `originals`, not `self._originals`
    window.setTimeout = function(fn, delay, ...args) {
      const id = originals.setTimeout.call(window, fn, delay, ...args);
      if (self._patched) self._timers.add(id);
      return id;
    };
    window.clearTimeout = function(id) {
      self._timers.delete(id);
      return originals.clearTimeout.call(window, id);
    };
    window.setInterval = function(fn, delay, ...args) {
      const id = originals.setInterval.call(window, fn, delay, ...args);
      if (self._patched) self._intervals.add(id);
      return id;
    };
    window.clearInterval = function(id) {
      self._intervals.delete(id);
      return originals.clearInterval.call(window, id);
    };
    window.requestAnimationFrame = function(fn) {
      const id = originals.requestAnimationFrame.call(window, fn);
      if (self._patched) self._rafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = function(id) {
      self._rafs.delete(id);
      return originals.cancelAnimationFrame.call(window, id);
    };

    // Patch event listeners
    window.addEventListener = function(event, handler, options) {
      if (self._patched) self._eventListeners.push({ target: window, event, handler, options });
      return originals.addEventListener.call(window, event, handler, options);
    };
    window.removeEventListener = function(event, handler, options) {
      self._eventListeners = self._eventListeners.filter(
        l => !(l.target === window && l.event === event && l.handler === handler)
      );
      return originals.removeEventListener.call(window, event, handler, options);
    };

    this._patched = true;
    logger.wuDebug(`[ProxySandbox] Window patched for ${this.appName}`);
  }

  /**
   * Restore original window APIs.
   * Safe: patched functions still work via closure even after restore.
   */
  unpatchWindow() {
    if (!this._patched || !this._originals) return;

    window.setTimeout = this._originals.setTimeout;
    window.clearTimeout = this._originals.clearTimeout;
    window.setInterval = this._originals.setInterval;
    window.clearInterval = this._originals.clearInterval;
    window.requestAnimationFrame = this._originals.requestAnimationFrame;
    window.cancelAnimationFrame = this._originals.cancelAnimationFrame;
    window.addEventListener = this._originals.addEventListener;
    window.removeEventListener = this._originals.removeEventListener;

    // NOTE: Do NOT null _originals — patched closures may still reference
    // the sandbox instance (e.g. React scheduler caches setTimeout).
    // The closure uses `originals` (local const), not `this._originals`.
    this._patched = false;
    logger.wuDebug(`[ProxySandbox] Window unpatched for ${this.appName}`);
  }

  // ================================================================
  // PROXY INTERCEPTS - for code running through the proxy
  // ================================================================

  /**
   * Intercept property access on the proxy.
   * Returns wrapped API or undefined to fall through.
   */
  _intercept(prop, target) {
    const self = this;

    switch (prop) {
      // --- Timer hijacking ---
      case 'setTimeout':
        return function(fn, delay, ...args) {
          const id = target.setTimeout(fn, delay, ...args);
          self._timers.add(id);
          return id;
        };
      case 'clearTimeout':
        return function(id) {
          self._timers.delete(id);
          target.clearTimeout(id);
        };
      case 'setInterval':
        return function(fn, delay, ...args) {
          const id = target.setInterval(fn, delay, ...args);
          self._intervals.add(id);
          return id;
        };
      case 'clearInterval':
        return function(id) {
          self._intervals.delete(id);
          target.clearInterval(id);
        };
      case 'requestAnimationFrame':
        return function(fn) {
          const id = target.requestAnimationFrame(fn);
          self._rafs.add(id);
          return id;
        };
      case 'cancelAnimationFrame':
        return function(id) {
          self._rafs.delete(id);
          target.cancelAnimationFrame(id);
        };

      // --- Event listener tracking ---
      case 'addEventListener':
        return function(event, handler, options) {
          self._eventListeners.push({ target, event, handler, options });
          target.addEventListener(event, handler, options);
        };
      case 'removeEventListener':
        return function(event, handler, options) {
          self._eventListeners = self._eventListeners.filter(
            l => !(l.target === target && l.event === event && l.handler === handler)
          );
          target.removeEventListener(event, handler, options);
        };

      // --- DOM scoping ---
      case 'document':
        return this._getScopedDocument();

      // --- Storage scoping ---
      case 'localStorage':
        return this._getScopedStorage('local');
      case 'sessionStorage':
        return this._getScopedStorage('session');
    }

    return undefined;
  }

  // ================================================================
  // DOM SCOPING - querySelector searches inside shadow root
  // ================================================================

  _getScopedDocument() {
    if (this._scopedDocument) return this._scopedDocument;

    const root = this._shadowRoot || this._container;
    if (!root) return document; // No container set, pass through

    const self = this;

    this._scopedDocument = new Proxy(document, {
      get(target, prop) {
        switch (prop) {
          case 'querySelector':
            return (selector) => root.querySelector(selector);
          case 'querySelectorAll':
            return (selector) => root.querySelectorAll(selector);
          case 'getElementById':
            return (id) => root.querySelector(`#${CSS.escape(id)}`);
          case 'getElementsByClassName':
            return (className) => root.querySelectorAll(`.${CSS.escape(className)}`);
          case 'getElementsByTagName':
            return (tag) => root.querySelectorAll(tag);

          // Track document event listeners too
          case 'addEventListener':
            return function(event, handler, options) {
              self._eventListeners.push({ target, event, handler, options });
              target.addEventListener(event, handler, options);
            };
          case 'removeEventListener':
            return function(event, handler, options) {
              self._eventListeners = self._eventListeners.filter(
                l => !(l.target === target && l.event === event && l.handler === handler)
              );
              target.removeEventListener(event, handler, options);
            };

          // createElement, createTextNode, etc. - pass through
          default: {
            const value = target[prop];
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
          }
        }
      }
    });

    return this._scopedDocument;
  }

  // ================================================================
  // STORAGE SCOPING - localStorage/sessionStorage with app prefix
  // ================================================================

  _getScopedStorage(type) {
    const cacheKey = type === 'local' ? '_scopedLocalStorage' : '_scopedSessionStorage';
    if (this[cacheKey]) return this[cacheKey];

    const realStorage = type === 'local' ? window.localStorage : window.sessionStorage;
    if (!realStorage) return realStorage;

    const prefix = `wu_${this.appName}_`;

    this[cacheKey] = {
      getItem(key) {
        return realStorage.getItem(prefix + key);
      },
      setItem(key, value) {
        realStorage.setItem(prefix + key, String(value));
      },
      removeItem(key) {
        realStorage.removeItem(prefix + key);
      },
      clear() {
        // Only clear this app's keys
        const toRemove = [];
        for (let i = 0; i < realStorage.length; i++) {
          const k = realStorage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach(k => realStorage.removeItem(k));
      },
      key(index) {
        let count = 0;
        for (let i = 0; i < realStorage.length; i++) {
          const k = realStorage.key(i);
          if (k && k.startsWith(prefix)) {
            if (count === index) return k.slice(prefix.length);
            count++;
          }
        }
        return null;
      },
      get length() {
        let count = 0;
        for (let i = 0; i < realStorage.length; i++) {
          if (realStorage.key(i)?.startsWith(prefix)) count++;
        }
        return count;
      }
    };

    return this[cacheKey];
  }

  // ================================================================
  // UTILITIES
  // ================================================================

  _isConstructor(fn) {
    try {
      return fn.prototype && fn.prototype.constructor === fn;
    } catch {
      return false;
    }
  }

  getProxy() {
    return this.active ? this.proxy : null;
  }

  isActive() {
    return this.active;
  }

  getStats() {
    return {
      appName: this.appName,
      active: this.active,
      patched: this._patched,
      modifiedKeys: Array.from(this.modifiedKeys),
      isolatedPropsCount: Object.keys(this.fakeWindow).length,
      trackedTimers: this._timers.size,
      trackedIntervals: this._intervals.size,
      trackedRAFs: this._rafs.size,
      trackedEventListeners: this._eventListeners.length,
      hasContainer: !!this._container,
      hasShadowRoot: !!this._shadowRoot
    };
  }
}
