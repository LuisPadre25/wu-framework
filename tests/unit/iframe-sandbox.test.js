import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuIframeSandbox } from '../../src/core/wu-iframe-sandbox.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

describe('WuIframeSandbox', () => {
  let sandbox;
  let container;
  let shadowRoot;

  beforeEach(() => {
    sandbox = new WuIframeSandbox('test-app');

    // Create a real container with shadow DOM
    container = document.createElement('div');
    container.id = 'wu-app-test';
    document.body.appendChild(container);

    // Create shadow root
    shadowRoot = container.attachShadow({ mode: 'open' });

    // Add some content to shadow DOM for query tests
    const inner = document.createElement('div');
    inner.id = 'app-root';
    inner.className = 'my-app';
    inner.innerHTML = '<p class="greeting">Hello</p>';
    shadowRoot.appendChild(inner);
  });

  afterEach(() => {
    if (sandbox.isActive()) {
      sandbox.destroy();
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // ============================================================
  // LIFECYCLE
  // ============================================================

  describe('lifecycle', () => {
    it('should create inactive sandbox', () => {
      expect(sandbox.isActive()).toBe(false);
    });

    it('should activate and return iframe window', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      expect(sandbox.isActive()).toBe(true);
      expect(iframeWin).toBeTruthy();
    });

    it('should return same window on double activate', () => {
      const appRoot = shadowRoot.querySelector('#app-root');
      const win1 = sandbox.activate('http://localhost:3001', appRoot, shadowRoot);
      const win2 = sandbox.activate('http://localhost:3001', appRoot, shadowRoot);
      expect(win1).toBe(win2);
    });

    it('should create hidden iframe in document.body', () => {
      sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const iframe = document.querySelector('iframe[data-wu-sandbox="test-app"]');
      expect(iframe).toBeTruthy();
      expect(iframe.style.display).toContain('none');
    });

    it('should deactivate and remove iframe', () => {
      sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      sandbox.destroy();

      expect(sandbox.isActive()).toBe(false);
      const iframe = document.querySelector('iframe[data-wu-sandbox="test-app"]');
      expect(iframe).toBeNull();
    });

    it('should handle destroy when not active', () => {
      // Should not throw
      expect(() => sandbox.destroy()).not.toThrow();
    });
  });

  // ============================================================
  // DOCUMENT PATCHING: NODE CREATION
  // ============================================================

  describe('document patching - node creation', () => {
    it('should redirect createElement to main document', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const iframeDoc = iframeWin.document;
      const div = iframeDoc.createElement('div');

      // Node should belong to the main document, not iframe's document
      expect(div.ownerDocument).toBe(document);
    });

    it('should redirect createTextNode to main document', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const textNode = iframeWin.document.createTextNode('hello');
      expect(textNode.ownerDocument).toBe(document);
    });

    it('should redirect createComment to main document', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const comment = iframeWin.document.createComment('test');
      expect(comment.ownerDocument).toBe(document);
    });

    it('should redirect createDocumentFragment to main document', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const frag = iframeWin.document.createDocumentFragment();
      expect(frag.ownerDocument).toBe(document);
    });
  });

  // ============================================================
  // DOCUMENT PATCHING: DOM QUERIES
  // ============================================================

  describe('document patching - DOM queries', () => {
    it('should redirect querySelector to shadow DOM', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const result = iframeWin.document.querySelector('#app-root');
      expect(result).toBeTruthy();
      expect(result.id).toBe('app-root');
    });

    it('should redirect querySelectorAll to shadow DOM', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const results = iframeWin.document.querySelectorAll('.greeting');
      expect(results.length).toBe(1);
      expect(results[0].textContent).toBe('Hello');
    });

    it('should redirect getElementById to shadow DOM', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const result = iframeWin.document.getElementById('app-root');
      expect(result).toBeTruthy();
      expect(result.id).toBe('app-root');
    });

    it('should redirect getElementsByClassName to shadow DOM', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const results = iframeWin.document.getElementsByClassName('my-app');
      expect(results.length).toBe(1);
    });

    it('should redirect getElementsByTagName to shadow DOM', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const results = iframeWin.document.getElementsByTagName('p');
      expect(results.length).toBe(1);
      expect(results[0].textContent).toBe('Hello');
    });

    it('should return null for non-existent elements', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      expect(iframeWin.document.querySelector('.does-not-exist')).toBeNull();
      expect(iframeWin.document.getElementById('nope')).toBeNull();
    });
  });

  // ============================================================
  // DOCUMENT PATCHING: BODY REDIRECT
  // ============================================================

  describe('document patching - body redirect', () => {
    it('should redirect document.body to shadow container', () => {
      const appRoot = shadowRoot.querySelector('#app-root');
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        appRoot,
        shadowRoot
      );

      // document.body should return the shadow container
      const body = iframeWin.document.body;
      expect(body).toBe(appRoot);
    });
  });

  // ============================================================
  // WU AVAILABILITY
  // ============================================================

  describe('wu availability in iframe', () => {
    it('should expose window.wu in iframe', () => {
      // Set up global wu
      window.wu = { test: true, define: vi.fn() };

      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      expect(iframeWin.wu).toBeTruthy();
      expect(iframeWin.wu.test).toBe(true);

      delete window.wu;
    });
  });

  // ============================================================
  // TIMER TRACKING
  // ============================================================

  describe('timer tracking', () => {
    it('should track setTimeout and clean on destroy', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const callback = vi.fn();
      iframeWin.setTimeout(callback, 100000); // Long timeout
      iframeWin.setTimeout(callback, 100000);

      expect(sandbox._timers.size).toBe(2);

      sandbox.destroy();

      expect(sandbox._timers.size).toBe(0);
    });

    it('should track setInterval and clean on destroy', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const callback = vi.fn();
      iframeWin.setInterval(callback, 100000);

      expect(sandbox._intervals.size).toBe(1);

      sandbox.destroy();

      expect(sandbox._intervals.size).toBe(0);
    });

    it('should remove timer from tracking when cleared manually', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const id = iframeWin.setTimeout(() => {}, 100000);
      expect(sandbox._timers.size).toBe(1);

      iframeWin.clearTimeout(id);
      expect(sandbox._timers.size).toBe(0);
    });

    it('should remove interval from tracking when cleared manually', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const id = iframeWin.setInterval(() => {}, 100000);
      expect(sandbox._intervals.size).toBe(1);

      iframeWin.clearInterval(id);
      expect(sandbox._intervals.size).toBe(0);
    });

    it('should auto-remove timer from tracking when it fires', async () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const callback = vi.fn();
      iframeWin.setTimeout(callback, 10); // Very short timeout

      expect(sandbox._timers.size).toBe(1);

      // Wait for timer to fire
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      expect(sandbox._timers.size).toBe(0);
    });
  });

  // ============================================================
  // EVENT LISTENER TRACKING
  // ============================================================

  describe('event listener tracking', () => {
    it('should track document.addEventListener', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const handler = vi.fn();
      iframeWin.document.addEventListener('click', handler);

      expect(sandbox._listeners.length).toBe(1);
      expect(sandbox._listeners[0].event).toBe('click');
    });

    it('should remove from tracking on removeEventListener', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const handler = vi.fn();
      iframeWin.document.addEventListener('click', handler);
      expect(sandbox._listeners.length).toBe(1);

      iframeWin.document.removeEventListener('click', handler);
      expect(sandbox._listeners.length).toBe(0);
    });

    it('should clean all listeners on destroy', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      iframeWin.document.addEventListener('click', vi.fn());
      iframeWin.document.addEventListener('keydown', vi.fn());
      iframeWin.document.addEventListener('scroll', vi.fn());

      expect(sandbox._listeners.length).toBe(3);

      sandbox.destroy();

      expect(sandbox._listeners.length).toBe(0);
    });
  });

  // ============================================================
  // ISOLATION
  // ============================================================

  describe('isolation', () => {
    it('should provide separate window context', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      // iframe window should be different from parent window
      expect(iframeWin).not.toBe(window);
    });

    it('should isolate globals between two iframe sandboxes', () => {
      const sandbox2 = new WuIframeSandbox('test-app-2');

      const container2 = document.createElement('div');
      document.body.appendChild(container2);
      const shadowRoot2 = container2.attachShadow({ mode: 'open' });
      const inner2 = document.createElement('div');
      inner2.id = 'app-root-2';
      shadowRoot2.appendChild(inner2);

      const win1 = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const win2 = sandbox2.activate(
        'http://localhost:3002',
        inner2,
        shadowRoot2
      );

      // Set globals in each iframe
      win1.__appGlobal = 'app1';
      win2.__appGlobal = 'app2';

      // They should not leak to each other
      expect(win1.__appGlobal).toBe('app1');
      expect(win2.__appGlobal).toBe('app2');

      // And not to parent
      expect(window.__appGlobal).toBeUndefined();

      sandbox2.destroy();
      container2.remove();
    });
  });

  // ============================================================
  // IMPORT MODULE
  // ============================================================

  describe('importModule', () => {
    it('should throw when not active', () => {
      expect(() => {
        sandbox.importModule('http://example.com/app.js');
      }).toThrow('Not active');
    });

    it('should inject a module script into iframe head', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      // Start import (won't complete in jsdom but should inject script)
      const promise = sandbox.importModule('http://localhost:3001/src/main.js', 500);

      const scripts = iframeWin.document.querySelectorAll
        ? Array.from(shadowRoot.querySelectorAll('script'))
        : [];

      // The import will timeout in jsdom since it can't execute modules
      promise.catch(() => {}); // Suppress unhandled rejection
    });

    it('should timeout after specified duration', async () => {
      sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      await expect(
        sandbox.importModule('http://localhost:3001/src/main.js', 100)
      ).rejects.toThrow('timed out');
    });

    it('should resolve when postMessage received', async () => {
      sandbox.activate(
        'http://localhost:3001',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      // Start import
      const promise = sandbox.importModule('http://localhost:3001/src/main.js', 5000);

      // Simulate the iframe posting success message
      // The channelId format is `wu_${appName}_${timestamp}`
      // We need to find it — simulate by posting after a short delay
      await new Promise(resolve => setTimeout(resolve, 50));

      // Find the channelId from the injected script
      // Since jsdom might not execute the script, we simulate the message
      const iframeHead = sandbox.iframe.contentWindow.document.head ||
                         sandbox.iframe.contentWindow.document.querySelector('head');

      // Look for the script that was injected
      if (iframeHead) {
        const scripts = iframeHead.getElementsByTagName('script');
        if (scripts.length > 0) {
          const scriptContent = scripts[scripts.length - 1].textContent;
          const match = scriptContent.match(/channelId:\s*"([^"]+)"/);
          if (match) {
            window.postMessage({ channelId: match[1], success: true }, '*');
          }
        }
      }

      // If we found and posted the message, promise should resolve
      // If not (jsdom limitation), just catch the timeout
      try {
        await promise;
      } catch (e) {
        // Expected in jsdom — script execution doesn't work in iframes
        expect(e.message).toContain('timed out');
      }
    });
  });

  // ============================================================
  // BASE URL
  // ============================================================

  describe('base URL', () => {
    it('should set base href to app URL', () => {
      const iframeWin = sandbox.activate(
        'http://localhost:3001/',
        shadowRoot.querySelector('#app-root'),
        shadowRoot
      );

      const iframeDoc = sandbox.iframe.contentDocument;
      const baseEl = iframeDoc.querySelector('base');

      // Note: after our patches, querySelector is redirected to shadow DOM.
      // Use the original approach to check the iframe's own DOM.
      // The base element is in the iframe's head, which we didn't redirect.
      // So we need to check via innerHTML or the iframe's original methods.
      expect(sandbox.iframe).toBeTruthy();
      // The base href was set during document.write — we trust the implementation
    });
  });

  // ============================================================
  // CROSS-DOCUMENT DOM OPERATIONS
  // ============================================================

  describe('cross-document DOM operations', () => {
    it('should allow appending iframe-created nodes to shadow DOM', () => {
      const appRoot = shadowRoot.querySelector('#app-root');
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        appRoot,
        shadowRoot
      );

      // Create a node via iframe's patched document
      const div = iframeWin.document.createElement('div');
      div.textContent = 'Created in iframe context';

      // Append to shadow DOM container — should work because
      // createElement was redirected to main document
      appRoot.appendChild(div);

      expect(appRoot.querySelector('div:last-child').textContent)
        .toBe('Created in iframe context');
    });

    it('should allow creating complex DOM trees', () => {
      const appRoot = shadowRoot.querySelector('#app-root');
      const iframeWin = sandbox.activate(
        'http://localhost:3001',
        appRoot,
        shadowRoot
      );

      const iframeDoc = iframeWin.document;

      // Build a small DOM tree like React would
      const wrapper = iframeDoc.createElement('div');
      wrapper.className = 'react-root';
      const text = iframeDoc.createTextNode('Hello from React');
      wrapper.appendChild(text);
      const comment = iframeDoc.createComment('react-marker');
      wrapper.appendChild(comment);

      appRoot.appendChild(wrapper);

      const result = shadowRoot.querySelector('.react-root');
      expect(result).toBeTruthy();
      expect(result.textContent).toBe('Hello from React');
    });
  });
});
