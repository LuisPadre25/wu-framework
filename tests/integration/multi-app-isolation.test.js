import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuProxySandbox } from '../../src/core/wu-proxy-sandbox.js';
import { WuEventBus } from '../../src/core/wu-event-bus.js';
import { WuStore } from '../../src/core/wu-store.js';

// Suppress logger
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

describe('Multi-App Isolation', () => {
  let sandboxA, sandboxB;

  beforeEach(() => {
    sandboxA = new WuProxySandbox('app-a');
    sandboxB = new WuProxySandbox('app-b');
  });

  afterEach(() => {
    if (sandboxA.isActive()) sandboxA.deactivate();
    if (sandboxB.isActive()) sandboxB.deactivate();
    // Clean up localStorage
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('wu_')) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  });

  // ============================================================
  // GLOBAL ISOLATION
  // ============================================================

  describe('global variable isolation', () => {
    it('should isolate globals between two sandboxes', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.appData = 'from-A';
      proxyB.appData = 'from-B';

      expect(proxyA.appData).toBe('from-A');
      expect(proxyB.appData).toBe('from-B');
      expect(window.appData).toBeUndefined();
    });

    it('should not leak globals after deactivation', () => {
      const proxyA = sandboxA.activate();
      proxyA.leaked = 'should-not-exist';
      sandboxA.deactivate();

      const proxyB = sandboxB.activate();
      expect(proxyB.leaked).toBeUndefined();
    });

    it('should read shared window properties independently', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      // Both should see the real window.location
      expect(proxyA.location).toBe(window.location);
      expect(proxyB.location).toBe(window.location);

      // Override in A should not affect B
      proxyA.location = 'overridden';
      expect(proxyA.location).toBe('overridden');
      expect(proxyB.location).toBe(window.location);
    });
  });

  // ============================================================
  // TIMER ISOLATION
  // ============================================================

  describe('timer isolation', () => {
    it('should track timers independently per sandbox', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.setTimeout(vi.fn(), 100000);
      proxyA.setTimeout(vi.fn(), 100000);
      proxyB.setInterval(vi.fn(), 100000);

      expect(sandboxA.getStats().trackedTimers).toBe(2);
      expect(sandboxA.getStats().trackedIntervals).toBe(0);
      expect(sandboxB.getStats().trackedTimers).toBe(0);
      expect(sandboxB.getStats().trackedIntervals).toBe(1);
    });

    it('should clean only own timers on deactivate', () => {
      const fnA = vi.fn();
      const fnB = vi.fn();

      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.setTimeout(fnA, 100000);
      proxyB.setTimeout(fnB, 100000);

      // Deactivate A
      sandboxA.deactivate();
      expect(sandboxA.getStats().trackedTimers).toBe(0);
      // B's timers should be unaffected
      expect(sandboxB.getStats().trackedTimers).toBe(1);
    });
  });

  // ============================================================
  // EVENT LISTENER ISOLATION
  // ============================================================

  describe('event listener isolation', () => {
    it('should track listeners independently per sandbox', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.addEventListener('click', vi.fn());
      proxyA.addEventListener('scroll', vi.fn());
      proxyB.addEventListener('resize', vi.fn());

      expect(sandboxA.getStats().trackedEventListeners).toBe(2);
      expect(sandboxB.getStats().trackedEventListeners).toBe(1);
    });

    it('should clean only own listeners on deactivate', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      const handlerA = vi.fn();
      const handlerB = vi.fn();

      proxyA.addEventListener('custom-event', handlerA);
      proxyB.addEventListener('custom-event', handlerB);

      sandboxA.deactivate();

      // B's listener should still be tracked
      expect(sandboxB.getStats().trackedEventListeners).toBe(1);
    });
  });

  // ============================================================
  // STORAGE ISOLATION
  // ============================================================

  describe('storage isolation', () => {
    it('should isolate localStorage between apps', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.localStorage.setItem('token', 'abc-from-A');
      proxyB.localStorage.setItem('token', 'xyz-from-B');

      expect(proxyA.localStorage.getItem('token')).toBe('abc-from-A');
      expect(proxyB.localStorage.getItem('token')).toBe('xyz-from-B');

      // Real keys are prefixed differently
      expect(localStorage.getItem('wu_app-a_token')).toBe('abc-from-A');
      expect(localStorage.getItem('wu_app-b_token')).toBe('xyz-from-B');
    });

    it('should clear only own storage keys', () => {
      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      proxyA.localStorage.setItem('data', 'A');
      proxyB.localStorage.setItem('data', 'B');

      proxyA.localStorage.clear();

      expect(proxyA.localStorage.getItem('data')).toBeNull();
      expect(proxyB.localStorage.getItem('data')).toBe('B');
    });
  });

  // ============================================================
  // DOM ISOLATION
  // ============================================================

  describe('DOM scoping isolation', () => {
    it('should scope queries to own container', () => {
      // Create two containers
      const containerA = document.createElement('div');
      const elA = document.createElement('button');
      elA.className = 'submit';
      elA.textContent = 'Submit A';
      containerA.appendChild(elA);

      const containerB = document.createElement('div');
      const elB = document.createElement('button');
      elB.className = 'submit';
      elB.textContent = 'Submit B';
      containerB.appendChild(elB);

      sandboxA.setContainer(containerA, containerA);
      sandboxB.setContainer(containerB, containerB);

      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      const foundA = proxyA.document.querySelector('.submit');
      const foundB = proxyB.document.querySelector('.submit');

      expect(foundA.textContent).toBe('Submit A');
      expect(foundB.textContent).toBe('Submit B');
    });

    it('should not find elements from other sandboxes', () => {
      const containerA = document.createElement('div');
      const uniqueEl = document.createElement('div');
      uniqueEl.id = 'only-in-a';
      containerA.appendChild(uniqueEl);

      const containerB = document.createElement('div');

      sandboxA.setContainer(containerA, containerA);
      sandboxB.setContainer(containerB, containerB);

      const proxyA = sandboxA.activate();
      const proxyB = sandboxB.activate();

      expect(proxyA.document.querySelector('#only-in-a')).toBeTruthy();
      expect(proxyB.document.querySelector('#only-in-a')).toBeNull();
    });
  });

  // ============================================================
  // EVENT BUS CROSS-APP COMMUNICATION
  // ============================================================

  describe('event bus cross-app communication', () => {
    it('should allow apps to communicate via shared event bus', () => {
      const bus = new WuEventBus();
      const receivedByB = vi.fn();

      // App B listens
      bus.on('cart:updated', receivedByB);

      // App A emits
      bus.emit('cart:updated', { items: 3 }, { appName: 'app-a' });

      expect(receivedByB).toHaveBeenCalledTimes(1);
      expect(receivedByB.mock.calls[0][0].data).toEqual({ items: 3 });
      expect(receivedByB.mock.calls[0][0].appName).toBe('app-a');
    });

    it('should keep event bus independent from sandbox lifecycle', () => {
      const bus = new WuEventBus();
      const callback = vi.fn();

      bus.on('test', callback);

      // Activate and deactivate sandbox
      sandboxA.activate();
      bus.emit('test', 'during-active');
      sandboxA.deactivate();

      bus.emit('test', 'after-deactivate');
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // STORE ISOLATION
  // ============================================================

  describe('store isolation between apps', () => {
    it('should share state via store (intentional)', async () => {
      const store = new WuStore();
      const callbackB = vi.fn();

      // App B subscribes
      store.on('cart.count', callbackB);

      // App A writes
      store.set('cart.count', 5);

      await vi.waitFor(() => {
        expect(callbackB).toHaveBeenCalledWith(5, 'cart.count');
      });
    });

    it('should allow per-app namespacing in store', () => {
      const store = new WuStore();

      // App A writes in its namespace
      store.set('app-a.settings.theme', 'dark');
      // App B writes in its namespace
      store.set('app-b.settings.theme', 'light');

      expect(store.get('app-a.settings.theme')).toBe('dark');
      expect(store.get('app-b.settings.theme')).toBe('light');
    });
  });

  // ============================================================
  // WINDOW PATCHING ISOLATION
  // ============================================================

  describe('sequential patchWindow isolation', () => {
    it('should track side effects during patched window phase', () => {
      sandboxA.activate();
      sandboxA.patchWindow();

      const fn = vi.fn();
      const id = window.setTimeout(fn, 100000);

      expect(sandboxA.getStats().trackedTimers).toBe(1);

      sandboxA.unpatchWindow();
      sandboxA.deactivate();

      // Timer should have been cleaned by deactivate
      expect(sandboxA.getStats().trackedTimers).toBe(0);
    });

    it('should restore original APIs after sequential patching', () => {
      const originalSetTimeout = window.setTimeout;

      sandboxA.activate();
      sandboxA.patchWindow();
      sandboxA.unpatchWindow();

      sandboxB.activate();
      sandboxB.patchWindow();
      sandboxB.unpatchWindow();

      expect(window.setTimeout).toBe(originalSetTimeout);
    });
  });
});
