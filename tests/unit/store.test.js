import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuStore } from '../../src/core/wu-store.js';

describe('WuStore', () => {
  let store;

  beforeEach(() => {
    store = new WuStore();
  });

  // ============================================================
  // BASIC GET / SET
  // ============================================================

  describe('get / set', () => {
    it('should set and get a simple value', () => {
      store.set('name', 'wu');
      expect(store.get('name')).toBe('wu');
    });

    it('should set and get nested values via dot notation', () => {
      store.set('user.name', 'John');
      store.set('user.age', 30);
      expect(store.get('user.name')).toBe('John');
      expect(store.get('user.age')).toBe(30);
    });

    it('should create intermediate objects automatically', () => {
      store.set('a.b.c.d', 'deep');
      expect(store.get('a.b.c.d')).toBe('deep');
      expect(store.get('a.b.c')).toEqual({ d: 'deep' });
      expect(store.get('a.b')).toEqual({ c: { d: 'deep' } });
    });

    it('should return entire state with no path', () => {
      store.set('x', 1);
      store.set('y', 2);
      const state = store.get();
      expect(state).toEqual({ x: 1, y: 2 });
    });

    it('should return undefined for non-existent paths', () => {
      expect(store.get('nonexistent')).toBeUndefined();
      expect(store.get('a.b.c')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      store.set('key', 'first');
      expect(store.get('key')).toBe('first');
      store.set('key', 'second');
      expect(store.get('key')).toBe('second');
    });

    it('should handle object values', () => {
      const obj = { items: [1, 2, 3], nested: { ok: true } };
      store.set('data', obj);
      expect(store.get('data')).toEqual(obj);
      expect(store.get('data.items')).toEqual([1, 2, 3]);
      expect(store.get('data.nested.ok')).toBe(true);
    });
  });

  // ============================================================
  // RING BUFFER
  // ============================================================

  describe('ring buffer', () => {
    it('should return sequence numbers', () => {
      const seq1 = store.set('a', 1);
      const seq2 = store.set('b', 2);
      expect(seq2).toBeGreaterThan(seq1);
    });

    it('should buffer size be power of two', () => {
      const s = new WuStore(100);
      expect(s.bufferSize).toBe(128); // next power of 2
    });

    it('should wrap around ring buffer', () => {
      const small = new WuStore(4); // bufferSize = 4
      // Write more than buffer size
      for (let i = 0; i < 10; i++) {
        small.set(`key${i}`, i);
      }
      // All values should still be accessible in state
      expect(small.get('key9')).toBe(9);
      expect(small.get('key0')).toBe(0);
    });

    it('should track recent events', () => {
      store.set('a', 1);
      store.set('b', 2);
      store.set('c', 3);
      const recent = store.getRecentEvents(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].path).toBe('c');
      expect(recent[1].path).toBe('b');
    });
  });

  // ============================================================
  // SUBSCRIPTIONS
  // ============================================================

  describe('subscriptions', () => {
    it('should notify exact path listeners', async () => {
      const callback = vi.fn();
      store.on('user.name', callback);
      store.set('user.name', 'Alice');

      // Notifications are async via queueMicrotask
      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith('Alice', 'user.name');
      });
    });

    it('should return unsubscribe function', async () => {
      const callback = vi.fn();
      const unsub = store.on('counter', callback);

      store.set('counter', 1);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

      unsub();
      store.set('counter', 2);

      // Wait a tick and verify no additional calls
      await new Promise(r => setTimeout(r, 10));
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should notify parent path listeners', async () => {
      const callback = vi.fn();
      store.on('user', callback);
      store.set('user.name', 'Bob');

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalled();
        // Parent listener gets the parent value
        const callArg = callback.mock.calls[0][0];
        expect(callArg).toEqual({ name: 'Bob' });
      });
    });

    it('should support wildcard subscriptions', async () => {
      const callback = vi.fn();
      store.on('user.*', callback);
      store.set('user.name', 'Charlie');

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(
          expect.objectContaining({ path: 'user.name', value: 'Charlie' })
        );
      });
    });

    it('should not notify unrelated paths', async () => {
      const callback = vi.fn();
      store.on('user.name', callback);
      store.set('user.age', 25);

      // Wait a tick
      await new Promise(r => setTimeout(r, 10));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // BATCH
  // ============================================================

  describe('batch', () => {
    it('should set multiple values at once', () => {
      const seqs = store.batch({
        'user.name': 'Dave',
        'user.age': 40,
        'theme': 'dark'
      });
      expect(seqs).toHaveLength(3);
      expect(store.get('user.name')).toBe('Dave');
      expect(store.get('user.age')).toBe(40);
      expect(store.get('theme')).toBe('dark');
    });
  });

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear', () => {
    it('should reset all state', () => {
      store.set('a', 1);
      store.set('b', 2);
      store.on('a', vi.fn());
      store.clear();
      expect(store.get()).toEqual({});
      expect(store.getMetrics().listenerCount).toBe(0);
    });
  });

  // ============================================================
  // METRICS
  // ============================================================

  describe('metrics', () => {
    it('should track reads and writes', () => {
      store.set('x', 1);
      store.set('y', 2);
      store.get('x');
      store.get('y');
      store.get('z');
      const m = store.getMetrics();
      expect(m.writes).toBe(2);
      expect(m.reads).toBe(3);
    });
  });
});
