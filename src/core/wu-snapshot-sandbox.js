/**
 * WU-SNAPSHOT-SANDBOX: JavaScript Isolation via Snapshots
 * Fallback for browsers without Proxy support.
 *
 * Takes a snapshot of window state before mount,
 * restores original state on deactivate.
 * Also tracks timers and event listeners for cleanup.
 */

import { logger } from './wu-logger.js';

export class WuSnapshotSandbox {
  constructor(appName) {
    this.appName = appName;
    this.proxy = window;
    this.snapshot = new Map();
    this.modifiedKeys = new Set();
    this.active = false;

    // Side-effect tracking (same as ProxySandbox)
    this._timers = new Set();
    this._intervals = new Set();
    this._rafs = new Set();
    this._eventListeners = [];

    // Window patching state
    this._patched = false;
    this._originals = null;
  }

  /**
   * Activate sandbox - capture window snapshot and start tracking.
   */
  activate() {
    if (this.active) return this.proxy;

    this.snapshot.clear();
    this.modifiedKeys.clear();

    // Capture current window state
    for (const key in window) {
      try {
        this.snapshot.set(key, window[key]);
      } catch {
        // Some properties may be inaccessible
      }
    }

    this.active = true;
    logger.wuDebug(`[SnapshotSandbox] Activated for ${this.appName} (${this.snapshot.size} props)`);
    return this.proxy;
  }

  /**
   * Deactivate sandbox - restore snapshot AND clean side effects.
   */
  deactivate() {
    if (!this.active) return;

    // Unpatch window if patched
    this.unpatchWindow();

    // --- Clean tracked timers ---
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

    // --- Clean tracked event listeners ---
    const listenerCount = this._eventListeners.length;
    for (const { target, event, handler, options } of this._eventListeners) {
      try { target.removeEventListener(event, handler, options); } catch {}
    }
    this._eventListeners = [];

    // --- Restore window snapshot ---
    let restoredCount = 0;
    let deletedCount = 0;

    for (const key in window) {
      try {
        const currentValue = window[key];
        const originalValue = this.snapshot.get(key);

        if (currentValue !== originalValue) {
          if (this.snapshot.has(key)) {
            window[key] = originalValue;
            restoredCount++;
          } else {
            try {
              delete window[key];
              deletedCount++;
            } catch {}
          }
        }
      } catch {}
    }

    this.snapshot.clear();
    this.modifiedKeys.clear();
    this.active = false;

    if (timerCount > 0 || listenerCount > 0) {
      logger.wuDebug(
        `[SnapshotSandbox] ${this.appName} cleanup: ${timerCount} timers, ${listenerCount} listeners, ${restoredCount} restored, ${deletedCount} deleted`
      );
    }
    logger.wuDebug(`[SnapshotSandbox] Deactivated for ${this.appName}`);
  }

  // ================================================================
  // WINDOW PATCHING - same interface as ProxySandbox
  // ================================================================

  patchWindow() {
    if (this._patched) return;

    const self = this;

    // Capture in local closure — survives unpatch safely
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

    this._originals = originals;

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
    logger.wuDebug(`[SnapshotSandbox] Window patched for ${this.appName}`);
  }

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

    this._patched = false;
    logger.wuDebug(`[SnapshotSandbox] Window unpatched for ${this.appName}`);
  }

  // ================================================================
  // UTILITIES
  // ================================================================

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
      snapshotSize: this.snapshot.size,
      trackedTimers: this._timers.size,
      trackedIntervals: this._intervals.size,
      trackedRAFs: this._rafs.size,
      trackedEventListeners: this._eventListeners.length
    };
  }
}
