import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuEventBus } from '../../src/core/wu-event-bus.js';

describe('WuEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new WuEventBus();
  });

  // ============================================================
  // EMIT / ON / OFF
  // ============================================================

  describe('emit / on / off', () => {
    it('should emit and receive events', () => {
      const callback = vi.fn();
      bus.on('test', callback);
      bus.emit('test', { msg: 'hello' });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data).toEqual({ msg: 'hello' });
    });

    it('should include event metadata', () => {
      const callback = vi.fn();
      bus.on('test', callback);
      bus.emit('test', 'data', { appName: 'myApp' });
      const event = callback.mock.calls[0][0];
      expect(event.name).toBe('test');
      expect(event.data).toBe('data');
      expect(event.appName).toBe('myApp');
      expect(event.timestamp).toBeDefined();
    });

    it('should support multiple listeners for same event', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      bus.on('multi', cb1);
      bus.on('multi', cb2);
      bus.emit('multi', 'data');
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe with off()', () => {
      const callback = vi.fn();
      bus.on('test', callback);
      bus.emit('test', 'first');
      expect(callback).toHaveBeenCalledTimes(1);

      bus.off('test', callback);
      bus.emit('test', 'second');
      expect(callback).toHaveBeenCalledTimes(1); // no more calls
    });

    it('should return unsubscribe function from on()', () => {
      const callback = vi.fn();
      const unsub = bus.on('test', callback);
      bus.emit('test', 'a');
      expect(callback).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit('test', 'b');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in listeners without crashing', () => {
      const badCallback = vi.fn(() => { throw new Error('oops'); });
      const goodCallback = vi.fn();

      bus.on('test', badCallback);
      bus.on('test', goodCallback);

      // Should not throw
      expect(() => bus.emit('test', 'data')).not.toThrow();
      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
    });

    it('should not fail when emitting with no listeners', () => {
      expect(() => bus.emit('no-listeners', 'data')).not.toThrow();
    });
  });

  // ============================================================
  // ONCE
  // ============================================================

  describe('once', () => {
    it('should fire listener only once', () => {
      const callback = vi.fn();
      bus.once('one-time', callback);
      bus.emit('one-time', 'first');
      bus.emit('one-time', 'second');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data).toBe('first');
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = bus.once('one-time', callback);
      unsub();
      bus.emit('one-time', 'data');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // WILDCARDS
  // ============================================================

  describe('wildcards', () => {
    it('should match prefix wildcard: app.*', () => {
      const callback = vi.fn();
      bus.on('app.*', callback);
      bus.emit('app.mounted', { name: 'header' });
      bus.emit('app.unmounted', { name: 'header' });
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should match suffix wildcard: *.error', () => {
      const callback = vi.fn();
      bus.on('*.error', callback);
      bus.emit('app.error', 'crash');
      bus.emit('network.error', 'timeout');
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should NOT match unrelated events', () => {
      const callback = vi.fn();
      bus.on('user.*', callback);
      bus.emit('app.mounted', 'data');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should match multi-level wildcard: app.*.ready', () => {
      const callback = vi.fn();
      bus.on('app.*.ready', callback);
      bus.emit('app.header.ready', 'data');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should be disableable', () => {
      bus.configure({ enableWildcards: false });
      const callback = vi.fn();
      bus.on('app.*', callback);
      bus.emit('app.mounted', 'data');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // HISTORY & REPLAY
  // ============================================================

  describe('history & replay', () => {
    it('should store events in history', () => {
      bus.emit('a', 1);
      bus.emit('b', 2);
      expect(bus.history).toHaveLength(2);
    });

    it('should limit history to maxHistory', () => {
      bus.configure({ maxHistory: 3 });
      bus.emit('a', 1);
      bus.emit('b', 2);
      bus.emit('c', 3);
      bus.emit('d', 4);
      expect(bus.history).toHaveLength(3);
      expect(bus.history[0].name).toBe('b'); // oldest was shifted out
    });

    it('should replay events', () => {
      bus.emit('user.login', { id: 1 });
      bus.emit('user.logout', { id: 1 });
      bus.emit('app.error', 'crash');

      const callback = vi.fn();
      bus.replay('user.*', callback);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should replay exact event name', () => {
      bus.emit('app.ready', 'v1');
      bus.emit('app.error', 'oops');

      const callback = vi.fn();
      bus.replay('app.ready', callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data).toBe('v1');
    });

    it('should clear history', () => {
      bus.emit('a', 1);
      bus.emit('b', 2);
      bus.clearHistory();
      expect(bus.history).toHaveLength(0);
    });

    it('should clear history by pattern', () => {
      bus.emit('user.login', 1);
      bus.emit('app.ready', 2);
      bus.emit('user.logout', 3);
      bus.clearHistory('user.*');
      expect(bus.history).toHaveLength(1);
      expect(bus.history[0].name).toBe('app.ready');
    });
  });

  // ============================================================
  // STRICT MODE & SECURITY
  // ============================================================

  describe('strict mode', () => {
    it('should reject events from unregistered apps in strict mode', () => {
      bus.enableStrictMode();
      const callback = vi.fn();
      bus.on('test', callback);
      const result = bus.emit('test', 'data', { appName: 'unknown-app' });
      expect(result).toBe(false);
      expect(callback).not.toHaveBeenCalled();
      expect(bus.getStats().rejected).toBe(1);
    });

    it('should allow events from registered apps', () => {
      bus.enableStrictMode();
      bus.registerApp('my-app');
      const callback = vi.fn();
      bus.on('test', callback);
      const result = bus.emit('test', 'data', { appName: 'my-app' });
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it('should always allow system events', () => {
      bus.enableStrictMode();
      const callback = vi.fn();
      bus.on('wu:ready', callback);
      const result = bus.emit('wu:ready', 'data', { appName: 'unregistered' });
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it('should allow everything in non-strict mode (default)', () => {
      const callback = vi.fn();
      bus.on('test', callback);
      bus.emit('test', 'data', { appName: 'any-app' });
      expect(callback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // STATS & CLEANUP
  // ============================================================

  describe('stats & cleanup', () => {
    it('should track stats', () => {
      bus.on('a', vi.fn());
      bus.on('b', vi.fn());
      bus.emit('a', 1);
      bus.emit('b', 2);
      bus.emit('c', 3);
      const stats = bus.getStats();
      expect(stats.emitted).toBe(3);
      expect(stats.subscriptions).toBe(2);
      expect(stats.activeListeners).toBe(2);
    });

    it('should removeAll listeners', () => {
      bus.on('a', vi.fn());
      bus.on('b', vi.fn());
      bus.removeAll();
      expect(bus.getStats().activeListeners).toBe(0);
    });
  });
});
