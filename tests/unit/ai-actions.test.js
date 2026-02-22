import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIActions } from '../../src/ai/wu-ai-actions.js';
import { WuAIPermissions } from '../../src/ai/wu-ai-permissions.js';

describe('WuAIActions', () => {
  let actions;
  let mockEventBus;
  let mockStore;
  let permissions;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    mockStore = {
      get: vi.fn((path) => {
        if (path === 'cart.items') return ['item1'];
        return undefined;
      }),
      set: vi.fn(),
    };
    permissions = new WuAIPermissions({
      permissions: { readStore: true, writeStore: true, emitEvents: true },
    });

    actions = new WuAIActions({
      eventBus: mockEventBus,
      store: mockStore,
      permissions,
    });
  });

  // ── Registration ──

  describe('register', () => {
    it('should register an action', () => {
      actions.register('test', {
        description: 'Test action',
        handler: async () => 'done',
      });
      expect(actions.has('test')).toBe(true);
      expect(actions.getNames()).toContain('test');
    });

    it('should throw without handler', () => {
      expect(() => actions.register('bad', {})).toThrow('must have a handler');
    });

    it('should unregister an action', () => {
      actions.register('temp', { handler: async () => {} });
      actions.unregister('temp');
      expect(actions.has('temp')).toBe(false);
    });
  });

  // ── Execution ──

  describe('execute', () => {
    it('should execute action and return result', async () => {
      actions.register('greet', {
        description: 'Greet user',
        parameters: { name: { type: 'string', required: true } },
        handler: async (params) => `Hello, ${params.name}!`,
      });

      const result = await actions.execute('greet', { name: 'Wu' });
      expect(result.success).toBe(true);
      expect(result.result).toBe('Hello, Wu!');
    });

    it('should fail on unregistered action', async () => {
      const result = await actions.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not registered');
    });

    it('should fail on invalid params', async () => {
      actions.register('strict', {
        parameters: { id: { type: 'number', required: true } },
        handler: async () => 'ok',
      });

      const result = await actions.execute('strict', { id: 'not-a-number' });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Invalid params');
    });

    it('should fail on missing required params', async () => {
      actions.register('need-id', {
        parameters: { id: { type: 'string', required: true } },
        handler: async () => 'ok',
      });

      const result = await actions.execute('need-id', {});
      expect(result.success).toBe(false);
      expect(result.reason).toContain("'id' is required");
    });

    it('should catch handler errors', async () => {
      actions.register('fail', {
        handler: async () => { throw new Error('boom'); },
      });

      const result = await actions.execute('fail', {});
      expect(result.success).toBe(false);
      expect(result.reason).toBe('boom');
    });

    it('should emit executed event on success', async () => {
      actions.register('emitter', {
        handler: async () => 'ok',
      });

      await actions.execute('emitter', {}, { traceId: 'tr1' });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:action:executed',
        expect.objectContaining({ action: 'emitter', traceId: 'tr1' }),
        expect.any(Object),
      );
    });

    it('should emit error event on failure', async () => {
      actions.register('err', {
        handler: async () => { throw new Error('oops'); },
      });

      await actions.execute('err', {}, { traceId: 'tr2' });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:action:error',
        expect.objectContaining({ action: 'err', error: 'oops' }),
        expect.any(Object),
      );
    });
  });

  // ── Permission Check ──

  describe('permissions', () => {
    it('should deny action when permission missing', async () => {
      actions.register('restricted', {
        permissions: ['modifyDOM'],
        handler: async () => 'ok',
      });

      const result = await actions.execute('restricted', {});
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Permission denied');
    });

    it('should allow action when permission granted', async () => {
      permissions.configure({ modifyDOM: true });
      actions.register('allowed', {
        permissions: ['modifyDOM'],
        handler: async () => 'ok',
      });

      const result = await actions.execute('allowed', {});
      expect(result.success).toBe(true);
    });
  });

  // ── Sandboxed API ──

  describe('sandboxed API', () => {
    it('should provide getState to handler', async () => {
      actions.register('reader', {
        handler: async (params, api) => api.getState('cart.items'),
      });

      const result = await actions.execute('reader', {});
      expect(result.success).toBe(true);
      expect(result.result).toEqual(['item1']);
    });

    it('should provide setState when permitted', async () => {
      actions.register('writer', {
        permissions: ['writeStore'],
        handler: async (params, api) => {
          api.setState('cart.total', 100);
          return 'written';
        },
      });

      const result = await actions.execute('writer', {});
      expect(result.success).toBe(true);
      expect(mockStore.set).toHaveBeenCalledWith('cart.total', 100);
    });

    it('should provide emit when permitted', async () => {
      actions.register('emitter', {
        handler: async (params, api) => {
          api.emit('custom:event', { x: 1 });
          return 'emitted';
        },
      });

      await actions.execute('emitter', {});
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'custom:event',
        { x: 1 },
        { appName: 'wu-ai' },
      );
    });
  });

  // ── Tool Schemas ──

  describe('getToolSchemas', () => {
    it('should return tool schemas for registered actions', () => {
      actions.register('search', {
        description: 'Search products',
        parameters: { query: { type: 'string', required: true } },
        handler: async () => [],
      });

      const tools = actions.getToolSchemas();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
      expect(tools[0].description).toBe('Search products');
      expect(tools[0].parameters.required).toContain('query');
    });
  });

  // ── Confirmation ──

  describe('confirmation flow', () => {
    it('should require confirmation when configured', async () => {
      actions.register('dangerous', {
        confirm: true,
        handler: async () => 'done',
      });

      // Start execution (will wait for confirmation)
      const promise = actions.execute('dangerous', {}, { callId: 'call1' });

      // Confirm it
      setTimeout(() => actions.confirmTool('call1'), 10);

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should deny on rejection', async () => {
      actions.register('risky', {
        confirm: true,
        handler: async () => 'done',
      });

      const promise = actions.execute('risky', {}, { callId: 'call2' });
      setTimeout(() => actions.rejectTool('call2'), 10);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.reason).toBe('User denied action');
    });
  });

  // ── Audit Log ──

  describe('execution log', () => {
    it('should log executions', async () => {
      actions.register('logged', { handler: async () => 'ok' });
      await actions.execute('logged', { x: 1 }, { traceId: 'tr' });

      const log = actions.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe('logged');
      expect(log[0].params).toEqual({ x: 1 });
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return stats', () => {
      actions.register('a', { handler: async () => {} });
      const stats = actions.getStats();
      expect(stats.registeredActions).toContain('a');
      expect(stats.executionLogSize).toBe(0);
    });
  });
});
