import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuCore } from '../../src/core/wu-core.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

/**
 * Helper: create a minimal WuCore with a fake app pre-registered,
 * a fake sandbox.create(), and a lifecycle defined — so we can
 * test mount/unmount/hide/show without needing real iframes or HTTP.
 */
function setupTestCore() {
  const core = new WuCore();

  // Create a real container in jsdom
  const hostContainer = document.createElement('div');
  hostContainer.id = 'test-app';
  document.body.appendChild(hostContainer);

  // Fake sandbox.create() — return a sandbox object with the essentials
  const fakeShadowContainer = document.createElement('div');
  fakeShadowContainer.id = 'wu-app-test-app';

  core.sandbox.create = vi.fn((appName, container, opts) => {
    const sandbox = {
      appName,
      container: fakeShadowContainer,
      hostContainer: container,
      shadowRoot: null,
      jsSandbox: { isActive: () => false, deactivate: vi.fn() },
      stylesReady: Promise.resolve(0),
      created: Date.now()
    };
    core.sandbox.sandboxes.set(appName, sandbox);
    return sandbox;
  });

  core.sandbox.cleanup = vi.fn((sandbox) => {
    core.sandbox.sandboxes.delete(sandbox.appName);
  });

  // Register a fake app
  core.apps.set('test-app', {
    name: 'test-app',
    url: 'http://localhost:5000',
    status: 'registered'
  });

  // Define lifecycle
  const mountFn = vi.fn();
  const unmountFn = vi.fn();
  const activateFn = vi.fn();
  const deactivateFn = vi.fn();

  core.define('test-app', {
    mount: mountFn,
    unmount: unmountFn,
    activate: activateFn,
    deactivate: deactivateFn
  });

  return {
    core,
    hostContainer,
    fakeShadowContainer,
    lifecycle: { mountFn, unmountFn, activateFn, deactivateFn }
  };
}

describe('Keep-alive', () => {
  let core, hostContainer, fakeShadowContainer, lifecycle;

  beforeEach(() => {
    ({ core, hostContainer, fakeShadowContainer, lifecycle } = setupTestCore());
  });

  afterEach(async () => {
    // Cleanup
    try { await core.destroy(); } catch {}
    if (hostContainer.parentNode) hostContainer.parentNode.removeChild(hostContainer);
  });

  // ============================================================
  // BASIC HIDE / SHOW
  // ============================================================

  describe('hide()', () => {
    it('should hide a mounted app', async () => {
      await core.mount('test-app', '#test-app');
      expect(core.mounted.has('test-app')).toBe(true);

      await core.hide('test-app');

      expect(core.mounted.has('test-app')).toBe(false);
      expect(core.hidden.has('test-app')).toBe(true);
      expect(hostContainer.style.display).toBe('none');
    });

    it('should call deactivate lifecycle hook', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      expect(lifecycle.deactivateFn).toHaveBeenCalledTimes(1);
      expect(lifecycle.deactivateFn).toHaveBeenCalledWith(fakeShadowContainer);
    });

    it('should not call unmount lifecycle hook', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      expect(lifecycle.unmountFn).not.toHaveBeenCalled();
    });

    it('should emit app:hidden event', async () => {
      await core.mount('test-app', '#test-app');

      const handler = vi.fn();
      core.eventBus.on('app:hidden', handler);

      await core.hide('test-app');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ appName: 'test-app' }) })
      );
    });

    it('should warn when hiding a non-mounted app', async () => {
      const { logger } = await import('../../src/core/wu-logger.js');
      await core.hide('non-existent');
      expect(logger.wuWarn).toHaveBeenCalled();
    });

    it('should store containerSelector in hidden entry', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      const hidden = core.hidden.get('test-app');
      expect(hidden.containerSelector).toBe('#test-app');
    });
  });

  describe('show()', () => {
    it('should show a hidden app instantly', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      await core.show('test-app');

      expect(core.hidden.has('test-app')).toBe(false);
      expect(core.mounted.has('test-app')).toBe(true);
      expect(hostContainer.style.display).toBe('');
    });

    it('should call activate lifecycle hook', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');
      await core.show('test-app');

      expect(lifecycle.activateFn).toHaveBeenCalledTimes(1);
      expect(lifecycle.activateFn).toHaveBeenCalledWith(fakeShadowContainer);
    });

    it('should NOT call mount lifecycle again', async () => {
      await core.mount('test-app', '#test-app');
      lifecycle.mountFn.mockClear();

      await core.hide('test-app');
      await core.show('test-app');

      expect(lifecycle.mountFn).not.toHaveBeenCalled();
    });

    it('should emit app:shown event with showTime', async () => {
      await core.mount('test-app', '#test-app');

      const handler = vi.fn();
      core.eventBus.on('app:shown', handler);

      await core.hide('test-app');
      await core.show('test-app');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            appName: 'test-app',
            showTime: expect.any(Number)
          })
        })
      );
    });

    it('should warn when showing a non-hidden app', async () => {
      const { logger } = await import('../../src/core/wu-logger.js');
      await core.show('non-existent');
      expect(logger.wuWarn).toHaveBeenCalled();
    });
  });

  // ============================================================
  // MULTIPLE HIDE/SHOW CYCLES
  // ============================================================

  describe('multiple cycles', () => {
    it('should support hide → show → hide → show', async () => {
      await core.mount('test-app', '#test-app');

      // Cycle 1
      await core.hide('test-app');
      expect(core.hidden.has('test-app')).toBe(true);
      await core.show('test-app');
      expect(core.mounted.has('test-app')).toBe(true);

      // Cycle 2
      await core.hide('test-app');
      expect(core.hidden.has('test-app')).toBe(true);
      await core.show('test-app');
      expect(core.mounted.has('test-app')).toBe(true);

      expect(lifecycle.deactivateFn).toHaveBeenCalledTimes(2);
      expect(lifecycle.activateFn).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // UNMOUNT WITH keepAlive OPTION
  // ============================================================

  describe('unmount with keepAlive', () => {
    it('should hide instead of destroy when keepAlive option is true', async () => {
      await core.mount('test-app', '#test-app');
      await core.unmount('test-app', { keepAlive: true });

      expect(core.hidden.has('test-app')).toBe(true);
      expect(core.mounted.has('test-app')).toBe(false);
      expect(lifecycle.unmountFn).not.toHaveBeenCalled();
    });

    it('should respect app-level keepAlive config', async () => {
      // Set keepAlive on the registered app
      core.apps.get('test-app').keepAlive = true;

      await core.mount('test-app', '#test-app');
      await core.unmount('test-app');

      expect(core.hidden.has('test-app')).toBe(true);
      expect(lifecycle.unmountFn).not.toHaveBeenCalled();
    });

    it('should force destroy even with keepAlive', async () => {
      core.apps.get('test-app').keepAlive = true;

      await core.mount('test-app', '#test-app');
      await core.unmount('test-app', { force: true });

      expect(core.hidden.has('test-app')).toBe(false);
      expect(core.mounted.has('test-app')).toBe(false);
      expect(lifecycle.unmountFn).toHaveBeenCalled();
    });

    it('per-call keepAlive overrides app config', async () => {
      // App config says no keepAlive
      core.apps.get('test-app').keepAlive = false;

      await core.mount('test-app', '#test-app');
      // But per-call says yes
      await core.unmount('test-app', { keepAlive: true });

      expect(core.hidden.has('test-app')).toBe(true);
    });
  });

  // ============================================================
  // MOUNT DETECTS HIDDEN STATE
  // ============================================================

  describe('mount detects hidden state', () => {
    it('should show instantly when mounting a hidden app to same container', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');
      lifecycle.mountFn.mockClear();

      await core.mount('test-app', '#test-app');

      // Should have shown, not re-mounted
      expect(core.mounted.has('test-app')).toBe(true);
      expect(lifecycle.mountFn).not.toHaveBeenCalled();
      expect(lifecycle.activateFn).toHaveBeenCalled();
    });
  });

  // ============================================================
  // isHidden()
  // ============================================================

  describe('isHidden()', () => {
    it('should return false for non-existent app', () => {
      expect(core.isHidden('nope')).toBe(false);
    });

    it('should return false for mounted app', async () => {
      await core.mount('test-app', '#test-app');
      expect(core.isHidden('test-app')).toBe(false);
    });

    it('should return true for hidden app', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');
      expect(core.isHidden('test-app')).toBe(true);
    });

    it('should return false after showing', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');
      await core.show('test-app');
      expect(core.isHidden('test-app')).toBe(false);
    });
  });

  // ============================================================
  // DESTROY CLEANS HIDDEN APPS
  // ============================================================

  describe('destroy()', () => {
    it('should clean up hidden apps on framework destroy', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      expect(core.hidden.size).toBe(1);

      await core.destroy();

      expect(core.hidden.size).toBe(0);
      expect(core.mounted.size).toBe(0);
    });
  });

  // ============================================================
  // DOM PRESERVATION
  // ============================================================

  describe('DOM preservation', () => {
    it('should preserve shadow container content when hidden', async () => {
      await core.mount('test-app', '#test-app');

      // Simulate app rendering content
      const appContent = document.createElement('div');
      appContent.textContent = 'Hello World';
      appContent.className = 'app-content';
      fakeShadowContainer.appendChild(appContent);

      await core.hide('test-app');

      // Content should still be there
      expect(fakeShadowContainer.querySelector('.app-content')).toBeTruthy();
      expect(fakeShadowContainer.querySelector('.app-content').textContent).toBe('Hello World');

      await core.show('test-app');

      // Still there after show
      expect(fakeShadowContainer.querySelector('.app-content').textContent).toBe('Hello World');
    });
  });

  // ============================================================
  // getStats() INCLUDES HIDDEN COUNT
  // ============================================================

  describe('getStats()', () => {
    it('should include hidden count', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      const stats = core.getStats();
      expect(stats.hidden).toBe(1);
      expect(stats.mounted).toBe(0);
    });
  });

  // ============================================================
  // FORCE DESTROY HIDDEN VIA unmount(name, { force: true })
  // ============================================================

  describe('force destroy hidden app', () => {
    it('should destroy a hidden app with force option', async () => {
      await core.mount('test-app', '#test-app');
      await core.hide('test-app');

      expect(core.hidden.has('test-app')).toBe(true);

      await core.unmount('test-app', { force: true });

      expect(core.hidden.has('test-app')).toBe(false);
      expect(core.mounted.has('test-app')).toBe(false);
    });
  });

  // ============================================================
  // OPTIONAL LIFECYCLE HOOKS (deactivate/activate not required)
  // ============================================================

  describe('optional lifecycle hooks', () => {
    it('should work without deactivate/activate hooks', async () => {
      // Redefine lifecycle WITHOUT deactivate/activate
      core.definitions.set('test-app', {
        mount: vi.fn(),
        unmount: vi.fn()
      });

      await core.mount('test-app', '#test-app');
      await core.hide('test-app');
      await core.show('test-app');

      expect(core.mounted.has('test-app')).toBe(true);
    });
  });
});
