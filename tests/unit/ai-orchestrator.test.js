import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAI } from '../../src/ai/wu-ai.js';

describe('WuAI (orchestrator)', () => {
  let ai;
  let mockEventBus;
  let mockStore;
  let mockCore;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
      once: vi.fn(),
      history: [],
    };
    mockStore = {
      get: vi.fn(),
      set: vi.fn(),
    };
    mockCore = {
      mounted: new Map(),
      getStats: () => ({ apps: [] }),
    };

    ai = new WuAI({
      eventBus: mockEventBus,
      store: mockStore,
      core: mockCore,
    });
  });

  // ── Initialization ──

  describe('init', () => {
    it('should lazy-initialize on first method call', () => {
      // Calling tools() triggers _ensureInit()
      const tools = ai.tools();
      // In jsdom, browser actions auto-register (10 tools)
      // Just verify init happened — tools may include browser actions
      expect(ai.getStats().initialized).toBe(true);
    });

    it('should accept explicit init with config', () => {
      ai.init({
        permissions: { writeStore: true },
        rateLimit: { requestsPerMinute: 50 },
        context: { budget: 8000 },
        conversation: { maxToolRounds: 3 },
      });

      expect(ai.permissions.check('writeStore')).toBe(true);
      expect(ai.getStats().initialized).toBe(true);
    });

    it('should emit ai:initialized event', () => {
      ai.init();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:initialized',
        {},
        { appName: 'wu-ai' },
      );
    });

    it('should allow reconfiguration', () => {
      ai.init({ permissions: { writeStore: false } });
      expect(ai.permissions.check('writeStore')).toBe(false);

      ai.init({ permissions: { writeStore: true } });
      expect(ai.permissions.check('writeStore')).toBe(true);
    });
  });

  // ── Provider Registration ──

  describe('provider', () => {
    it('should register a custom provider', () => {
      ai.provider('custom', {
        send: async (messages) => ({ content: 'response' }),
      });

      const stats = ai.getStats();
      expect(stats.provider.registeredProviders).toContain('custom');
    });

    it('should be chainable', () => {
      const result = ai.provider('test', {
        send: async () => ({ content: '' }),
      });
      expect(result).toBe(ai);
    });
  });

  // ── Actions ──

  describe('action', () => {
    it('should register an action', () => {
      ai.action('test', {
        description: 'Test action',
        handler: async () => 'done',
      });

      const tools = ai.tools();
      const customTool = tools.find(t => t.name === 'test');
      expect(customTool).toBeDefined();
      expect(customTool.name).toBe('test');
    });

    it('should be chainable', () => {
      const result = ai.action('a', { handler: async () => {} });
      expect(result).toBe(ai);
    });
  });

  // ── Execute (Paradigm 2) ──

  describe('execute', () => {
    it('should execute action directly', async () => {
      ai.action('greet', {
        description: 'Greet',
        parameters: { name: { type: 'string' } },
        handler: async (params) => `Hello ${params.name}`,
      });

      const result = await ai.execute('greet', { name: 'Wu' });
      expect(result.success).toBe(true);
      expect(result.result).toBe('Hello Wu');
    });

    it('should fail on unregistered action', async () => {
      const result = await ai.execute('nonexistent', {});
      expect(result.success).toBe(false);
    });
  });

  // ── Triggers ──

  describe('trigger', () => {
    it('should register a trigger', () => {
      ai.trigger('test', {
        pattern: 'cart:*',
        prompt: 'Cart event',
      });

      const stats = ai.getStats();
      expect(stats.triggers.triggerCount).toBe(1);
    });

    it('should be chainable', () => {
      const result = ai.trigger('t', { pattern: '*', prompt: 'x' });
      expect(result).toBe(ai);
    });
  });

  // ── Context ──

  describe('context', () => {
    it('should expose context sub-API', () => {
      const ctx = ai.context;
      expect(ctx).toHaveProperty('configure');
      expect(ctx).toHaveProperty('register');
      expect(ctx).toHaveProperty('collect');
      expect(ctx).toHaveProperty('getSnapshot');
    });

    it('should configure context', () => {
      ai.context.configure({ budget: 5000 });
      expect(ai.getStats().context.budget).toBe(5000);
    });
  });

  // ── Conversation ──

  describe('conversation', () => {
    it('should expose conversation sub-API', () => {
      const conv = ai.conversation;
      expect(conv).toHaveProperty('getHistory');
      expect(conv).toHaveProperty('clear');
      expect(conv).toHaveProperty('clearAll');
      expect(conv).toHaveProperty('inject');
      expect(conv).toHaveProperty('getNamespaces');
      expect(conv).toHaveProperty('deleteNamespace');
    });
  });

  // ── Permissions ──

  describe('permissions', () => {
    it('should expose permissions sub-API', () => {
      const perm = ai.permissions;
      expect(perm).toHaveProperty('configure');
      expect(perm).toHaveProperty('check');
      expect(perm).toHaveProperty('getPermissions');
      expect(perm).toHaveProperty('setAllowedDomains');
    });
  });

  // ── Tools (Paradigm 2) ──

  describe('tools', () => {
    it('should return tools array (browser actions auto-register in jsdom)', () => {
      const tools = ai.tools();
      // In jsdom, browser actions (10 tools) auto-register
      // Verify no custom actions beyond browser ones
      const nonBrowserTools = tools.filter(t => !t.name.startsWith('browser_'));
      expect(nonBrowserTools).toEqual([]);
    });

    it('should return schemas for registered actions', () => {
      ai.action('search', {
        description: 'Search',
        parameters: { q: 'string' },
        handler: async () => [],
      });

      const tools = ai.tools();
      // Browser actions (10) auto-register in jsdom environment + our 1 custom action
      const customTool = tools.find(t => t.name === 'search');
      expect(customTool).toBeDefined();
      expect(customTool.name).toBe('search');
    });
  });

  // ── WebMCP Expose ──

  describe('expose', () => {
    it('should return false when navigator.modelContext is missing', () => {
      const result = ai.expose();
      expect(result).toBe(false);
    });
  });

  // ── Confirmation ──

  describe('confirmTool / rejectTool', () => {
    it('should not throw when not initialized', () => {
      expect(() => ai.confirmTool('id')).not.toThrow();
      expect(() => ai.rejectTool('id')).not.toThrow();
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return uninitialized stats', () => {
      // Create fresh instance without triggering init
      const freshAi = new WuAI({ eventBus: mockEventBus, store: mockStore, core: mockCore });
      expect(freshAi.getStats()).toEqual({ initialized: false });
    });

    it('should return full stats when initialized', () => {
      ai.init();
      const stats = ai.getStats();
      expect(stats.initialized).toBe(true);
      expect(stats).toHaveProperty('provider');
      expect(stats).toHaveProperty('permissions');
      expect(stats).toHaveProperty('context');
      expect(stats).toHaveProperty('actions');
      expect(stats).toHaveProperty('conversation');
      expect(stats).toHaveProperty('triggers');
    });
  });

  // ── Destroy ──

  describe('destroy', () => {
    it('should clean up and reset', () => {
      ai.init();
      ai.action('temp', { handler: async () => {} });
      ai.destroy();

      expect(ai.getStats()).toEqual({ initialized: false });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:destroyed',
        {},
        { appName: 'wu-ai' },
      );
    });

    it('should not throw when not initialized', () => {
      expect(() => ai.destroy()).not.toThrow();
    });
  });
});
