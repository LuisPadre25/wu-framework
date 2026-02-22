/**
 * 🚀 WU-STORE: Ultra-High Performance State Management
 *
 * Basado en patrones de Disruptor y Vert.x
 * - Ring Buffer para zero-allocation
 * - Lock-free operations
 * - Event Bus para pub/sub
 * - API minimalista: get(), set(), on()
 */

export class WuStore {
  constructor(bufferSize = 256) {
    // Ring Buffer configuration
    this.bufferSize = this.nextPowerOfTwo(bufferSize);
    this.mask = this.bufferSize - 1;
    this.buffer = new Array(this.bufferSize);
    this.cursor = 0;

    // State storage
    this.state = {};

    // Event listeners map: path -> Set of callbacks
    this.listeners = new Map();

    // Pattern listeners for wildcards
    this.patternListeners = new Map();

    // Performance metrics
    this.metrics = {
      reads: 0,
      writes: 0,
      notifications: 0
    };

    // Initialize ring buffer slots
    for (let i = 0; i < this.bufferSize; i++) {
      this.buffer[i] = { path: null, value: null, timestamp: 0 };
    }

    // No global pollution - proper library architecture
  }

  /**
   * Get value from store
   * @param {string} path - Dot notation path (e.g., 'user.name')
   * @returns {*} Value at path or entire state if no path
   */
  get(path) {
    this.metrics.reads++;

    if (!path) return this.state;

    // Fast path resolution with reduce
    return path.split('.').reduce((obj, key) => obj?.[key], this.state);
  }

  /**
   * Set value in store with Ring Buffer
   * @param {string} path - Dot notation path
   * @param {*} value - Value to set
   * @returns {number} Sequence number
   */
  set(path, value) {
    this.metrics.writes++;

    // Write to ring buffer (lock-free)
    const sequence = this.cursor++;
    const index = sequence & this.mask;

    // Reuse buffer slot (zero allocation)
    const event = this.buffer[index];
    event.path = path;
    event.value = value;
    event.timestamp = performance.now();

    // Update state synchronously
    this.updateState(path, value);

    // Schedule async notifications (non-blocking)
    queueMicrotask(() => {
      this.notify(path, value);
      this.notifyPatterns(path, value);
    });

    return sequence;
  }

  /**
   * Subscribe to state changes
   * @param {string} pattern - Path or pattern (supports * wildcard)
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(pattern, callback) {
    // Check if pattern contains wildcards
    if (pattern.includes('*')) {
      // Pattern subscription
      if (!this.patternListeners.has(pattern)) {
        this.patternListeners.set(pattern, new Set());
      }
      this.patternListeners.get(pattern).add(callback);

      // Return unsubscribe function
      return () => {
        const listeners = this.patternListeners.get(pattern);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this.patternListeners.delete(pattern);
          }
        }
      };
    } else {
      // Direct path subscription
      if (!this.listeners.has(pattern)) {
        this.listeners.set(pattern, new Set());
      }
      this.listeners.get(pattern).add(callback);

      // Return unsubscribe function
      return () => {
        const listeners = this.listeners.get(pattern);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this.listeners.delete(pattern);
          }
        }
      };
    }
  }

  /**
   * Batch set multiple values
   * @param {Object} updates - Object with path:value pairs
   */
  batch(updates) {
    const sequences = [];

    for (const [path, value] of Object.entries(updates)) {
      sequences.push(this.set(path, value));
    }

    return sequences;
  }

  /**
   * Get current metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      bufferUtilization: (this.cursor % this.bufferSize) / this.bufferSize,
      listenerCount: this.listeners.size + this.patternListeners.size
    };
  }

  // Private methods

  nextPowerOfTwo(n) {
    return Math.pow(2, Math.ceil(Math.log2(n)));
  }

  updateState(path, value) {
    if (!path) {
      this.state = value;
      return;
    }

    const keys = path.split('.');
    const last = keys.pop();

    // Create nested structure if needed
    let target = this.state;
    for (const key of keys) {
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    target[last] = value;
  }

  notify(path, value) {
    this.metrics.notifications++;

    // Notify exact path listeners
    const exactListeners = this.listeners.get(path);
    if (exactListeners) {
      exactListeners.forEach(callback => {
        try {
          callback(value, path);
        } catch (error) {
          console.error('[WuStore] Listener error:', error);
        }
      });
    }

    // Notify parent path listeners
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join('.');
      const parentListeners = this.listeners.get(parentPath);
      if (parentListeners) {
        const parentValue = this.get(parentPath);
        parentListeners.forEach(callback => {
          try {
            callback(parentValue, parentPath);
          } catch (error) {
            console.error('[WuStore] Parent listener error:', error);
          }
        });
      }
    }
  }

  notifyPatterns(path, value) {
    // Check all pattern listeners
    for (const [pattern, listeners] of this.patternListeners) {
      if (this.matchesPattern(path, pattern)) {
        listeners.forEach(callback => {
          try {
            callback({ path, value });
          } catch (error) {
            console.error('[WuStore] Pattern listener error:', error);
          }
        });
      }
    }
  }

  matchesPattern(path, pattern) {
    // Convert pattern to regex
    // user.* matches user.name, user.email, etc.
    // *.name matches user.name, post.name, etc.
    // * matches everything

    if (pattern === '*') return true;

    const regexPattern = pattern
      .split('.')
      .map(part => part === '*' ? '[^.]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Clear all state and listeners
   */
  clear() {
    this.state = {};
    this.listeners.clear();
    this.patternListeners.clear();
    this.cursor = 0;

    // Clear buffer
    for (let i = 0; i < this.bufferSize; i++) {
      this.buffer[i].path = null;
      this.buffer[i].value = null;
      this.buffer[i].timestamp = 0;
    }
  }

  /**
   * Get recent events from ring buffer
   * @param {number} count - Number of recent events
   * @returns {Array} Recent events
   */
  getRecentEvents(count = 10) {
    const events = [];
    const start = Math.max(0, this.cursor - count);

    for (let i = start; i < this.cursor && events.length < count; i++) {
      const index = i & this.mask;
      const event = this.buffer[index];
      if (event.path) {
        events.push({
          path: event.path,
          value: event.value,
          timestamp: event.timestamp
        });
      }
    }

    return events.reverse();
  }
}

// Create singleton instance
const store = new WuStore();

// Export both class and instance
export default store;
