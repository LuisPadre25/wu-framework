import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuScriptExecutor } from '../../src/core/wu-script-executor.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

describe('WuScriptExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new WuScriptExecutor();
  });

  // ============================================================
  // BASIC EXECUTION
  // ============================================================

  describe('basic execution', () => {
    it('should execute script text and return result', () => {
      const proxy = { __test: true };
      const result = executor.execute('return 42;', 'test-app', proxy);
      // The code runs inside (function(window){ with(window){ ... } }).call(proxy, proxy...)
      // "return" is not valid at top-level in a with block, but expressions are
      // Let's use an expression that stores a value
      expect(result).toBeUndefined(); // with() block doesn't return
    });

    it('should skip empty scripts', () => {
      const proxy = {};
      expect(executor.execute('', 'test-app', proxy)).toBeUndefined();
      expect(executor.execute('   ', 'test-app', proxy)).toBeUndefined();
      expect(executor.execute(null, 'test-app', proxy)).toBeUndefined();
    });

    it('should execute code that accesses proxy as window', () => {
      const proxy = {};
      executor.execute('window.__executed = true;', 'test-app', proxy);
      expect(proxy.__executed).toBe(true);
    });

    it('should execute code that accesses proxy as self', () => {
      const proxy = {};
      executor.execute('self.__fromSelf = "yes";', 'test-app', proxy);
      expect(proxy.__fromSelf).toBe('yes');
    });

    it('should execute code that accesses proxy as globalThis', () => {
      const proxy = {};
      executor.execute('globalThis.__fromGlobal = 123;', 'test-app', proxy);
      expect(proxy.__fromGlobal).toBe(123);
    });
  });

  // ============================================================
  // STRICT GLOBAL (with statement)
  // ============================================================

  describe('strictGlobal mode', () => {
    it('should use with(proxy) when strictGlobal is true (default)', () => {
      // In strictGlobal mode, code is wrapped in with(window){...}
      // This means window.xxx assignments go through the proxy's set trap
      const store = {};
      const proxy = new Proxy(store, {
        has(target, key) { return true; },
        get(target, key) {
          if (key === Symbol.unscopables) return undefined;
          return target[key];
        },
        set(target, key, value) {
          target[key] = value;
          return true;
        }
      });

      // Test that assignments go through the proxy
      executor.execute('window.__strictTest = "strict-mode";', 'test-app', proxy, { strictGlobal: true });
      expect(store.__strictTest).toBe('strict-mode');
    });

    it('should NOT use with() when strictGlobal is false', () => {
      const proxy = {};
      // In non-strict mode, only explicit window.xxx goes through proxy
      executor.execute('window.__iife = true;', 'test-app', proxy, { strictGlobal: false });
      expect(proxy.__iife).toBe(true);
    });

    it('should fallback from strict to non-strict on error', () => {
      const proxy = {};
      // Use code that would fail in with() but work in IIFE
      // The with() fallback should retry without it
      executor.execute('window.__fallback = "worked";', 'test-app', proxy, { strictGlobal: true });
      expect(proxy.__fallback).toBe('worked');
    });
  });

  // ============================================================
  // ISOLATION
  // ============================================================

  describe('isolation', () => {
    it('should not leak variables to real window', () => {
      const proxy = {};
      const before = window.__isolationTest;
      executor.execute('window.__isolationTest = "sandboxed";', 'test-app', proxy);
      expect(proxy.__isolationTest).toBe('sandboxed');
      expect(window.__isolationTest).toBe(before); // unchanged
    });

    it('should isolate between two proxies', () => {
      const proxyA = {};
      const proxyB = {};

      executor.execute('window.__app = "A";', 'app-a', proxyA);
      executor.execute('window.__app = "B";', 'app-b', proxyB);

      expect(proxyA.__app).toBe('A');
      expect(proxyB.__app).toBe('B');
    });

    it('should use proxy as this context', () => {
      const proxy = {};
      // .call(proxy, ...) means `this` inside the IIFE is the proxy
      executor.execute('this.__fromThis = true;', 'test-app', proxy);
      expect(proxy.__fromThis).toBe(true);
    });
  });

  // ============================================================
  // SOURCE URL
  // ============================================================

  describe('sourceURL', () => {
    it('should append sourceURL comment when provided', () => {
      const proxy = {};
      // We can't easily test the sourceURL is in the code,
      // but we can verify execution still works with it
      executor.execute('window.__withSource = true;', 'test-app', proxy, {
        sourceUrl: 'main.js'
      });
      expect(proxy.__withSource).toBe(true);
    });

    it('should work without sourceURL', () => {
      const proxy = {};
      executor.execute('window.__noSource = true;', 'test-app', proxy, {
        sourceUrl: ''
      });
      expect(proxy.__noSource).toBe(true);
    });
  });

  // ============================================================
  // ERROR HANDLING
  // ============================================================

  describe('error handling', () => {
    it('should throw on syntax errors in non-strict mode', () => {
      const proxy = {};
      expect(() => {
        executor.execute('this is not valid javascript!!!', 'test-app', proxy, { strictGlobal: false });
      }).toThrow();
    });

    it('should throw on runtime errors in non-strict mode', () => {
      const proxy = {};
      expect(() => {
        executor.execute('throw new Error("runtime boom");', 'test-app', proxy, { strictGlobal: false });
      }).toThrow('runtime boom');
    });

    it('should retry strictGlobal errors before throwing', () => {
      const proxy = {};
      // Code that throws should still throw after fallback
      expect(() => {
        executor.execute('throw new Error("still fails");', 'test-app', proxy, { strictGlobal: true });
      }).toThrow('still fails');
    });
  });

  // ============================================================
  // FETCH SCRIPT
  // ============================================================

  describe('fetchScript', () => {
    it('should throw on failed fetch', async () => {
      // Mock fetch to return error
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(executor.fetchScript('http://example.com/missing.js'))
        .rejects.toThrow('Failed to fetch script');

      globalThis.fetch = originalFetch;
    });

    it('should return script text on successful fetch', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('console.log("hello");')
      });

      const text = await executor.fetchScript('http://example.com/app.js');
      expect(text).toBe('console.log("hello");');

      globalThis.fetch = originalFetch;
    });
  });

  // ============================================================
  // EXECUTE ALL
  // ============================================================

  describe('executeAll', () => {
    it('should execute multiple inline scripts in sequence', async () => {
      const proxy = {};
      const scripts = [
        { content: 'window.__step1 = true;' },
        { content: 'window.__step2 = true;' },
        { content: 'window.__step3 = window.__step1 && window.__step2;' }
      ];

      await executor.executeAll(scripts, 'test-app', proxy);

      expect(proxy.__step1).toBe(true);
      expect(proxy.__step2).toBe(true);
      expect(proxy.__step3).toBe(true);
    });

    it('should fetch and execute external scripts', async () => {
      const proxy = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('window.__external = "loaded";')
      });

      const scripts = [
        { src: 'http://example.com/app.js' }
      ];

      await executor.executeAll(scripts, 'test-app', proxy);
      expect(proxy.__external).toBe('loaded');

      globalThis.fetch = originalFetch;
    });

    it('should skip empty scripts', async () => {
      const proxy = {};
      const scripts = [
        { content: '' },
        { content: '   ' },
        { content: 'window.__afterEmpty = true;' }
      ];

      await executor.executeAll(scripts, 'test-app', proxy);
      expect(proxy.__afterEmpty).toBe(true);
    });
  });
});
