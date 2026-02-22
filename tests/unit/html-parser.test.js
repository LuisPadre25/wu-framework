import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WuHtmlParser } from '../../src/core/wu-html-parser.js';

// Suppress logger output during tests
vi.mock('../../src/core/wu-logger.js', () => ({
  logger: {
    wuDebug: vi.fn(),
    wuInfo: vi.fn(),
    wuWarn: vi.fn(),
    wuError: vi.fn()
  }
}));

describe('WuHtmlParser', () => {
  let parser;

  beforeEach(() => {
    parser = new WuHtmlParser();
  });

  afterEach(() => {
    parser.clearCache();
  });

  // ============================================================
  // PARSE: SCRIPT EXTRACTION
  // ============================================================

  describe('script extraction', () => {
    it('should extract inline scripts', () => {
      const html = '<div id="app"></div><script>console.log("hello");</script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.inline).toHaveLength(1);
      expect(result.scripts.inline[0]).toBe('console.log("hello");');
      expect(result.scripts.external).toHaveLength(0);
    });

    it('should extract external scripts', () => {
      const html = '<div id="app"></div><script src="/app.js"></script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.external).toHaveLength(1);
      expect(result.scripts.external[0]).toBe('http://localhost:3000/app.js');
      expect(result.scripts.inline).toHaveLength(0);
    });

    it('should extract both inline and external scripts', () => {
      const html = `
        <script>var x = 1;</script>
        <div id="app"></div>
        <script src="/vendor.js"></script>
        <script>var y = 2;</script>
        <script src="/main.js"></script>
      `;
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.inline).toHaveLength(2);
      expect(result.scripts.inline[0]).toBe('var x = 1;');
      expect(result.scripts.inline[1]).toBe('var y = 2;');

      expect(result.scripts.external).toHaveLength(2);
      expect(result.scripts.external[0]).toBe('http://localhost:3000/vendor.js');
      expect(result.scripts.external[1]).toBe('http://localhost:3000/main.js');
    });

    it('should skip type="module" scripts', () => {
      const html = `
        <script type="module">import { foo } from './foo.js';</script>
        <script>var regular = true;</script>
        <script type="module" src="/module.js"></script>
      `;
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.inline).toHaveLength(1);
      expect(result.scripts.inline[0]).toBe('var regular = true;');
      expect(result.scripts.external).toHaveLength(0);
    });

    it('should skip empty inline scripts', () => {
      const html = '<script></script><script>   </script><script>var x = 1;</script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.inline).toHaveLength(1);
      expect(result.scripts.inline[0]).toBe('var x = 1;');
    });

    it('should replace scripts with comments in DOM', () => {
      const html = '<div id="app"></div><script>console.log("hello");</script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.dom).not.toContain('<script');
      expect(result.dom).toContain('<!--wu:script-->');
    });
  });

  // ============================================================
  // PARSE: STYLE EXTRACTION
  // ============================================================

  describe('style extraction', () => {
    it('should extract inline styles', () => {
      const html = '<style>body { color: red; }</style><div id="app"></div>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.styles.inline).toHaveLength(1);
      expect(result.styles.inline[0]).toBe('body { color: red; }');
    });

    it('should extract external stylesheets', () => {
      const html = '<link rel="stylesheet" href="/styles.css"><div id="app"></div>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.styles.external).toHaveLength(1);
      expect(result.styles.external[0]).toBe('http://localhost:3000/styles.css');
    });

    it('should not extract non-stylesheet links', () => {
      const html = `
        <link rel="icon" href="/favicon.ico">
        <link rel="stylesheet" href="/app.css">
        <link rel="preload" href="/font.woff2">
      `;
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.styles.external).toHaveLength(1);
      expect(result.styles.external[0]).toBe('http://localhost:3000/app.css');
    });

    it('should skip empty inline styles', () => {
      const html = '<style></style><style>   </style><style>.app { display: flex; }</style>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.styles.inline).toHaveLength(1);
      expect(result.styles.inline[0]).toBe('.app { display: flex; }');
    });

    it('should replace styles with comments in DOM', () => {
      const html = '<style>body{}</style><link rel="stylesheet" href="/a.css">';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.dom).not.toContain('<style');
      expect(result.dom).not.toContain('<link');
      expect(result.dom).toContain('<!--wu:style-->');
      expect(result.dom).toContain('<!--wu:link-->');
    });
  });

  // ============================================================
  // PARSE: DOM CONTENT
  // ============================================================

  describe('DOM content', () => {
    it('should return clean DOM without scripts or styles', () => {
      const html = `
        <style>.app { color: blue; }</style>
        <div id="app">
          <h1>Hello</h1>
          <p>World</p>
        </div>
        <script>console.log("init");</script>
      `;
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.dom).toContain('<div id="app">');
      expect(result.dom).toContain('<h1>Hello</h1>');
      expect(result.dom).not.toContain('<script');
      expect(result.dom).not.toContain('<style');
    });

    it('should handle nested elements', () => {
      const html = `
        <div id="root">
          <div class="inner">
            <script>var nested = true;</script>
            <p>Content</p>
          </div>
        </div>
      `;
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.inline).toHaveLength(1);
      expect(result.scripts.inline[0]).toBe('var nested = true;');
      expect(result.dom).toContain('<p>Content</p>');
    });

    it('should handle empty HTML', () => {
      const result = parser.parse('', 'test-app', 'http://localhost:3000');

      expect(result.dom).toBe('');
      expect(result.scripts.inline).toHaveLength(0);
      expect(result.scripts.external).toHaveLength(0);
      expect(result.styles.inline).toHaveLength(0);
      expect(result.styles.external).toHaveLength(0);
    });
  });

  // ============================================================
  // URL RESOLUTION
  // ============================================================

  describe('URL resolution', () => {
    it('should resolve relative paths', () => {
      const html = '<script src="/assets/app.js"></script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.external[0]).toBe('http://localhost:3000/assets/app.js');
    });

    it('should keep absolute URLs unchanged', () => {
      const html = '<script src="https://cdn.example.com/lib.js"></script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.external[0]).toBe('https://cdn.example.com/lib.js');
    });

    it('should handle protocol-relative URLs', () => {
      const html = '<script src="//cdn.example.com/lib.js"></script>';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.scripts.external[0]).toBe('https://cdn.example.com/lib.js');
    });

    it('should resolve stylesheet URLs', () => {
      const html = '<link rel="stylesheet" href="/css/app.css">';
      const result = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result.styles.external[0]).toBe('http://localhost:3000/css/app.css');
    });
  });

  // ============================================================
  // CACHING
  // ============================================================

  describe('caching', () => {
    it('should cache parse results', () => {
      const html = '<div>Test</div><script>var a = 1;</script>';

      const result1 = parser.parse(html, 'test-app', 'http://localhost:3000');
      const result2 = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result1).toBe(result2); // Same reference (cached)
    });

    it('should not cache different apps with same HTML length', () => {
      // Cache key is `${appName}:${html.length}`, so different app names = different cache
      const html = '<div>Test</div>';

      const result1 = parser.parse(html, 'app-a', 'http://localhost:3000');
      const result2 = parser.parse(html, 'app-b', 'http://localhost:3000');

      // Different app names produce different cache keys
      expect(result1).not.toBe(result2);
    });

    it('should clear cache', () => {
      const html = '<div>Test</div><script>var a = 1;</script>';

      const result1 = parser.parse(html, 'test-app', 'http://localhost:3000');
      parser.clearCache();
      const result2 = parser.parse(html, 'test-app', 'http://localhost:3000');

      expect(result1).not.toBe(result2); // Different references after cache clear
      expect(result1).toEqual(result2); // But same content
    });
  });

  // ============================================================
  // FETCH HTML
  // ============================================================

  describe('fetchHtml', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should fetch HTML from URL', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<div id="app"></div><script>init();</script>')
      });

      const html = await parser.fetchHtml('http://localhost:3001', 'my-app');
      expect(html).toContain('<div id="app"></div>');
      expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:3001', expect.any(Object));
    });

    it('should throw on HTTP error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      });

      await expect(parser.fetchHtml('http://localhost:3001', 'my-app'))
        .rejects.toThrow('HTTP 500');
    });

    it('should throw on empty response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('')
      });

      await expect(parser.fetchHtml('http://localhost:3001', 'my-app'))
        .rejects.toThrow('Empty HTML');
    });
  });

  // ============================================================
  // FETCH AND PARSE
  // ============================================================

  describe('fetchAndParse', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should fetch and parse in one call', async () => {
      const mockHtml = `
        <style>.app { color: red; }</style>
        <div id="root">Hello</div>
        <script>window.wu.define("test", { mount: function(){} });</script>
      `;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml)
      });

      const result = await parser.fetchAndParse('http://localhost:3001', 'test-app');

      expect(result.dom).toContain('<div id="root">Hello</div>');
      expect(result.scripts.inline).toHaveLength(1);
      expect(result.styles.inline).toHaveLength(1);
      expect(result.styles.inline[0]).toBe('.app { color: red; }');
    });
  });
});
