import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIOrchestrate } from '../../src/ai/wu-ai-orchestrate.js';

// Mock browser primitives (jsdom doesn't have real DOM interaction)
vi.mock('../../src/ai/wu-ai-browser-primitives.js', () => ({
  clickElement: vi.fn((selector, text) => {
    if (selector === '#fail') return { error: 'Element not found: #fail' };
    return { clicked: selector || text };
  }),
  typeIntoElement: vi.fn((selector, text) => {
    if (selector === '#fail') return { error: 'Element not found: #fail' };
    return { typed: text, into: selector };
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────

async function collectSteps(generator) {
  const steps = [];
  for await (const step of generator) {
    steps.push(step);
  }
  return steps;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('WuAIOrchestrate', () => {
  let orchestrate;
  let actions;
  let conversation;
  let context;
  let permissions;
  let mockEventBus;
  let mockAgent;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

    actions = {
      register: vi.fn(),
      unregister: vi.fn(),
    };

    conversation = {
      send: vi.fn(() => Promise.resolve({
        content: 'Intent resolved successfully',
        tool_results: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
      deleteNamespace: vi.fn(),
    };

    context = {
      collect: vi.fn(() => Promise.resolve({})),
      getSnapshot: vi.fn(() => ({
        _mountedApps: ['orders', 'dashboard'],
        _store: { 'orders.count': 42 },
      })),
    };

    permissions = {
      check: vi.fn(() => true),
    };

    // Mock agent that yields steps and completes
    mockAgent = {
      run: vi.fn(async function* (goal, options) {
        const step1 = { step: 1, type: 'thinking', content: 'Working...', elapsed: 100 };
        if (options.onStep) options.onStep(step1);
        yield step1;
        const step2 = { step: 2, type: 'done', content: 'Done!', reason: 'completed', elapsed: 50 };
        if (options.onStep) options.onStep(step2);
        yield step2;
      }),
    };

    orchestrate = new WuAIOrchestrate({
      actions,
      conversation,
      context,
      permissions,
      eventBus: mockEventBus,
      agent: mockAgent,
    });
  });

  // ── Capability Registration ──

  describe('register', () => {
    it('should register a capability with qualified name', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      expect(actions.register).toHaveBeenCalledWith(
        'orders:getRecent',
        expect.objectContaining({
          description: '[orders] Get recent orders',
        }),
      );
    });

    it('should store capability in the internal map', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      expect(orchestrate.hasApp('orders')).toBe(true);
      expect(orchestrate.getTotalCapabilities()).toBe(1);
    });

    it('should support multiple capabilities per app', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });
      orchestrate.register('orders', 'filterByStatus', {
        description: 'Filter orders by status',
        handler: async () => [],
      });

      expect(orchestrate.getTotalCapabilities()).toBe(2);
      expect(actions.register).toHaveBeenCalledTimes(2);
    });

    it('should support capabilities across multiple apps', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });
      orchestrate.register('dashboard', 'updateKPIs', {
        description: 'Update KPI cards',
        handler: async () => {},
      });

      expect(orchestrate.getRegisteredApps()).toEqual(['orders', 'dashboard']);
      expect(orchestrate.getTotalCapabilities()).toBe(2);
    });

    it('should throw if appName is missing', () => {
      expect(() => {
        orchestrate.register('', 'getRecent', { handler: async () => {} });
      }).toThrow('requires both appName and actionName');
    });

    it('should throw if actionName is missing', () => {
      expect(() => {
        orchestrate.register('orders', '', { handler: async () => {} });
      }).toThrow('requires both appName and actionName');
    });

    it('should throw if handler is missing', () => {
      expect(() => {
        orchestrate.register('orders', 'getRecent', { description: 'test' });
      }).toThrow('must have a handler function');
    });

    it('should pass through action config (confirm, permissions, dangerous)', () => {
      const handler = async () => {};
      orchestrate.register('orders', 'deleteAll', {
        description: 'Delete all orders',
        handler,
        confirm: true,
        permissions: ['writeStore'],
        dangerous: true,
      });

      expect(actions.register).toHaveBeenCalledWith(
        'orders:deleteAll',
        expect.objectContaining({
          confirm: true,
          permissions: ['writeStore'],
          dangerous: true,
          handler,
        }),
      );
    });

    it('should use actionName as default description', () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });

      expect(actions.register).toHaveBeenCalledWith(
        'orders:getRecent',
        expect.objectContaining({
          description: '[orders] getRecent',
        }),
      );
    });
  });

  // ── Capability Removal ──

  describe('unregister', () => {
    it('should remove a single capability', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });
      orchestrate.register('orders', 'filter', {
        description: 'Filter orders',
        handler: async () => [],
      });

      orchestrate.unregister('orders', 'getRecent');

      expect(actions.unregister).toHaveBeenCalledWith('orders:getRecent');
      expect(orchestrate.getTotalCapabilities()).toBe(1);
      expect(orchestrate.hasApp('orders')).toBe(true);
    });

    it('should remove app entry when last capability is removed', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      orchestrate.unregister('orders', 'getRecent');

      expect(orchestrate.hasApp('orders')).toBe(false);
      expect(orchestrate.getTotalCapabilities()).toBe(0);
    });

    it('should handle unregistering non-existent capability gracefully', () => {
      expect(() => orchestrate.unregister('orders', 'nonexistent')).not.toThrow();
    });
  });

  describe('removeApp', () => {
    it('should remove all capabilities for an app', () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });
      orchestrate.register('orders', 'filter', {
        handler: async () => [],
      });
      orchestrate.register('dashboard', 'updateKPIs', {
        handler: async () => {},
      });

      const removed = orchestrate.removeApp('orders');

      expect(removed).toBe(2);
      expect(actions.unregister).toHaveBeenCalledWith('orders:getRecent');
      expect(actions.unregister).toHaveBeenCalledWith('orders:filter');
      expect(orchestrate.hasApp('orders')).toBe(false);
      expect(orchestrate.hasApp('dashboard')).toBe(true);
    });

    it('should emit ai:app:removed event', () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });

      orchestrate.removeApp('orders');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:app:removed',
        { appName: 'orders', capabilitiesRemoved: 1 },
        { appName: 'wu-ai' },
      );
    });

    it('should return 0 for non-existent app', () => {
      expect(orchestrate.removeApp('nonexistent')).toBe(0);
    });
  });

  // ── Capability Map ──

  describe('getCapabilityMap', () => {
    it('should return empty map when no capabilities registered', () => {
      expect(orchestrate.getCapabilityMap()).toEqual({});
    });

    it('should group capabilities by app', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });
      orchestrate.register('orders', 'filter', {
        description: 'Filter orders',
        handler: async () => [],
      });
      orchestrate.register('dashboard', 'updateKPIs', {
        description: 'Update KPIs',
        handler: async () => {},
      });

      const map = orchestrate.getCapabilityMap();

      expect(map.orders).toHaveLength(2);
      expect(map.dashboard).toHaveLength(1);
      expect(map.orders[0]).toEqual({
        action: 'orders:getRecent',
        description: 'Get recent orders',
      });
      expect(map.dashboard[0]).toEqual({
        action: 'dashboard:updateKPIs',
        description: 'Update KPIs',
      });
    });
  });

  describe('getRegisteredApps', () => {
    it('should return empty array initially', () => {
      expect(orchestrate.getRegisteredApps()).toEqual([]);
    });

    it('should return app names', () => {
      orchestrate.register('orders', 'getRecent', { handler: async () => [] });
      orchestrate.register('dashboard', 'update', { handler: async () => {} });

      const apps = orchestrate.getRegisteredApps();
      expect(apps).toContain('orders');
      expect(apps).toContain('dashboard');
    });
  });

  // ── Intent Resolution ──

  describe('resolve (intent)', () => {
    it('should send description to conversation with orchestrator prompt', async () => {
      const result = await orchestrate.resolve('Show me recent orders');

      expect(conversation.send).toHaveBeenCalledWith(
        'Show me recent orders',
        expect.objectContaining({
          systemPrompt: expect.stringContaining('orchestrator'),
        }),
      );
      expect(result.content).toBe('Intent resolved successfully');
      expect(result.resolved).toBe(true);
    });

    it('should use ephemeral namespace and auto-clean', async () => {
      await orchestrate.resolve('Test intent');

      const sendCall = conversation.send.mock.calls[0];
      const namespace = sendCall[1].namespace;
      expect(namespace).toMatch(/^intent:/);

      expect(conversation.deleteNamespace).toHaveBeenCalledWith(namespace);
    });

    it('should collect fresh context before building prompt', async () => {
      await orchestrate.resolve('Test');

      expect(context.collect).toHaveBeenCalled();

      // Verify collect was called before send
      const collectOrder = context.collect.mock.invocationCallOrder[0];
      const sendOrder = conversation.send.mock.invocationCallOrder[0];
      expect(collectOrder).toBeLessThan(sendOrder);
    });

    it('should include capability map in system prompt', async () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      await orchestrate.resolve('Show recent orders');

      const systemPrompt = conversation.send.mock.calls[0][1].systemPrompt;
      expect(systemPrompt).toContain('orders:getRecent');
      expect(systemPrompt).toContain('Get recent orders');
      expect(systemPrompt).toContain('CAPABILITY MAP');
    });

    it('should include mounted apps in system prompt', async () => {
      await orchestrate.resolve('Test');

      const systemPrompt = conversation.send.mock.calls[0][1].systemPrompt;
      expect(systemPrompt).toContain('MOUNTED APPS: orders, dashboard');
    });

    it('should include store state in system prompt', async () => {
      await orchestrate.resolve('Test');

      const systemPrompt = conversation.send.mock.calls[0][1].systemPrompt;
      expect(systemPrompt).toContain('orders.count');
    });

    it('should forward provider option', async () => {
      await orchestrate.resolve('Test', { provider: 'anthropic' });

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ provider: 'anthropic' }),
      );
    });

    it('should use default temperature of 0.3', async () => {
      await orchestrate.resolve('Test');

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ temperature: 0.3 }),
      );
    });

    it('should allow temperature override', async () => {
      await orchestrate.resolve('Test', { temperature: 0.8 });

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ temperature: 0.8 }),
      );
    });

    it('should forward maxTokens and signal', async () => {
      const controller = new AbortController();
      await orchestrate.resolve('Test', {
        maxTokens: 500,
        signal: controller.signal,
      });

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({
          maxTokens: 500,
          signal: controller.signal,
        }),
      );
    });

    it('should forward responseFormat', async () => {
      await orchestrate.resolve('Test', { responseFormat: 'json' });

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ responseFormat: 'json' }),
      );
    });

    it('should include plan hint in system prompt', async () => {
      await orchestrate.resolve('Update everything', {
        plan: ['orders:getRecent', 'dashboard:updateKPIs'],
      });

      const systemPrompt = conversation.send.mock.calls[0][1].systemPrompt;
      expect(systemPrompt).toContain('SUGGESTED PLAN');
      expect(systemPrompt).toContain('1. orders:getRecent');
      expect(systemPrompt).toContain('2. dashboard:updateKPIs');
    });

    it('should extract involved apps from tool results', async () => {
      conversation.send.mockResolvedValueOnce({
        content: 'Done',
        tool_results: [
          { name: 'orders:getRecent', result: [1, 2, 3] },
          { name: 'dashboard:updateKPIs', result: { ok: true } },
        ],
        usage: {},
      });

      const result = await orchestrate.resolve('Update everything');

      expect(result.appsInvolved).toContain('orders');
      expect(result.appsInvolved).toContain('dashboard');
      expect(result.appsInvolved).toHaveLength(2);
    });

    it('should handle tool results without colon (non-app actions)', async () => {
      conversation.send.mockResolvedValueOnce({
        content: 'Done',
        tool_results: [
          { name: 'browser_screenshot', result: 'base64...' },
        ],
        usage: {},
      });

      const result = await orchestrate.resolve('Take a screenshot');

      expect(result.appsInvolved).toEqual([]);
    });

    it('should emit ai:intent:start event', async () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });

      await orchestrate.resolve('Test intent');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:intent:start',
        expect.objectContaining({
          description: 'Test intent',
          capabilities: 1,
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should emit ai:intent:resolved event on success', async () => {
      await orchestrate.resolve('Test intent');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:intent:resolved',
        expect.objectContaining({
          resolved: true,
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should emit ai:intent:error event on failure', async () => {
      conversation.send.mockRejectedValueOnce(new Error('LLM error'));

      await expect(orchestrate.resolve('Test')).rejects.toThrow('LLM error');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:intent:error',
        expect.objectContaining({
          error: 'LLM error',
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should clean up namespace even on error', async () => {
      conversation.send.mockRejectedValueOnce(new Error('boom'));

      try {
        await orchestrate.resolve('Test');
      } catch {}

      expect(conversation.deleteNamespace).toHaveBeenCalled();
    });

    it('should throw on empty description', async () => {
      await expect(orchestrate.resolve('')).rejects.toThrow(
        'requires a description string',
      );
    });

    it('should throw on non-string description', async () => {
      await expect(orchestrate.resolve(42)).rejects.toThrow(
        'requires a description string',
      );
    });

    it('should handle empty content as not resolved', async () => {
      conversation.send.mockResolvedValueOnce({
        content: '',
        tool_results: [],
        usage: {},
      });

      const result = await orchestrate.resolve('Test');
      expect(result.resolved).toBe(false);
    });

    it('should handle context collection failure gracefully', async () => {
      context.collect.mockRejectedValueOnce(new Error('context error'));

      // Should not throw — context is best-effort
      const result = await orchestrate.resolve('Test');
      expect(result.content).toBe('Intent resolved successfully');
    });

    it('should handle null context gracefully', () => {
      const noCtx = new WuAIOrchestrate({
        actions,
        conversation,
        context: null,
        permissions,
        eventBus: mockEventBus,
      });

      // Should not throw during prompt building
      expect(() => noCtx.buildOrchestratorPrompt()).not.toThrow();
    });
  });

  // ── System Prompt ──

  describe('buildOrchestratorPrompt', () => {
    it('should include base orchestrator instructions', () => {
      const prompt = orchestrate.buildOrchestratorPrompt();

      expect(prompt).toContain('orchestrator');
      expect(prompt).toContain('microfrontend');
      expect(prompt).toContain('RULES:');
    });

    it('should include warning when no capabilities registered', () => {
      const prompt = orchestrate.buildOrchestratorPrompt();

      expect(prompt).toContain('No app capabilities are registered');
    });

    it('should include capability map', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });
      orchestrate.register('dashboard', 'updateKPIs', {
        description: 'Update KPI cards',
        handler: async () => {},
      });

      const prompt = orchestrate.buildOrchestratorPrompt();

      expect(prompt).toContain('CAPABILITY MAP:');
      expect(prompt).toContain('orders:');
      expect(prompt).toContain('orders:getRecent: Get recent orders');
      expect(prompt).toContain('dashboard:');
      expect(prompt).toContain('dashboard:updateKPIs: Update KPI cards');
    });

    it('should include plan hint when provided', () => {
      const prompt = orchestrate.buildOrchestratorPrompt({
        plan: ['orders:getRecent', 'dashboard:updateKPIs'],
      });

      expect(prompt).toContain('SUGGESTED PLAN');
      expect(prompt).toContain('1. orders:getRecent');
      expect(prompt).toContain('2. dashboard:updateKPIs');
    });

    it('should not include plan section when plan is empty', () => {
      const prompt = orchestrate.buildOrchestratorPrompt({ plan: [] });

      expect(prompt).not.toContain('SUGGESTED PLAN');
    });

    it('should include context snapshot', () => {
      const prompt = orchestrate.buildOrchestratorPrompt();

      expect(prompt).toContain('MOUNTED APPS: orders, dashboard');
      expect(prompt).toContain('CURRENT STATE:');
      expect(prompt).toContain('orders.count');
    });
  });

  // ── Configure ──

  describe('configure', () => {
    it('should set defaultProvider', async () => {
      orchestrate.configure({ defaultProvider: 'openai' });

      await orchestrate.resolve('Test');

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ provider: 'openai' }),
      );
    });

    it('should set defaultTemperature', async () => {
      orchestrate.configure({ defaultTemperature: 0.7 });

      await orchestrate.resolve('Test');

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ temperature: 0.7 }),
      );
    });

    it('should allow per-call override of configured defaults', async () => {
      orchestrate.configure({ defaultProvider: 'openai', defaultTemperature: 0.1 });

      await orchestrate.resolve('Test', { provider: 'anthropic', temperature: 0.9 });

      expect(conversation.send).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ provider: 'anthropic', temperature: 0.9 }),
      );
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = orchestrate.getStats();

      expect(stats.totalIntents).toBe(0);
      expect(stats.resolvedIntents).toBe(0);
      expect(stats.failedIntents).toBe(0);
      expect(stats.registeredApps).toEqual([]);
      expect(stats.totalCapabilities).toBe(0);
      expect(stats.capabilityMap).toEqual({});
    });

    it('should track resolved intents', async () => {
      await orchestrate.resolve('Test 1');
      await orchestrate.resolve('Test 2');

      const stats = orchestrate.getStats();
      expect(stats.totalIntents).toBe(2);
      expect(stats.resolvedIntents).toBe(2);
    });

    it('should track failed intents', async () => {
      conversation.send.mockRejectedValueOnce(new Error('fail'));

      try { await orchestrate.resolve('Test'); } catch {}

      const stats = orchestrate.getStats();
      expect(stats.totalIntents).toBe(1);
      expect(stats.failedIntents).toBe(1);
    });

    it('should include registered apps and capabilities', () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      const stats = orchestrate.getStats();
      expect(stats.registeredApps).toEqual(['orders']);
      expect(stats.totalCapabilities).toBe(1);
      expect(stats.capabilityMap.orders).toHaveLength(1);
    });

    it('should include config', () => {
      orchestrate.configure({ defaultProvider: 'openai' });
      const stats = orchestrate.getStats();
      expect(stats.config.defaultProvider).toBe('openai');
    });
  });

  // ── Destroy ──

  describe('destroy', () => {
    it('should remove all capabilities from action registry', () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });
      orchestrate.register('dashboard', 'update', {
        handler: async () => {},
      });

      orchestrate.destroy();

      expect(actions.unregister).toHaveBeenCalledWith('orders:getRecent');
      expect(actions.unregister).toHaveBeenCalledWith('dashboard:update');
    });

    it('should clear internal state', () => {
      orchestrate.register('orders', 'getRecent', {
        handler: async () => [],
      });

      orchestrate.destroy();

      expect(orchestrate.getTotalCapabilities()).toBe(0);
      expect(orchestrate.getRegisteredApps()).toEqual([]);
      expect(orchestrate.getCapabilityMap()).toEqual({});
    });

    it('should reset stats', async () => {
      await orchestrate.resolve('Test');

      orchestrate.destroy();

      const stats = orchestrate.getStats();
      expect(stats.totalIntents).toBe(0);
      expect(stats.resolvedIntents).toBe(0);
      expect(stats.failedIntents).toBe(0);
    });

    it('should not throw when empty', () => {
      expect(() => orchestrate.destroy()).not.toThrow();
    });
  });

  // ── Workflows ──

  describe('registerWorkflow', () => {
    it('should register a workflow', () => {
      orchestrate.registerWorkflow('register-user', {
        description: 'Register a new user',
        steps: [
          'Navigate to Customers',
          'Click Add Customer',
          'Fill name with {{name}}',
          'Click Submit',
        ],
        parameters: {
          name: { type: 'string', required: true },
        },
      });

      expect(orchestrate.hasWorkflow('register-user')).toBe(true);
    });

    it('should throw if name is empty', () => {
      expect(() => {
        orchestrate.registerWorkflow('', { steps: ['step'] });
      }).toThrow('requires a name');
    });

    it('should throw if steps are missing', () => {
      expect(() => {
        orchestrate.registerWorkflow('test', { description: 'test' });
      }).toThrow('must have a non-empty steps array');
    });

    it('should throw if steps array is empty', () => {
      expect(() => {
        orchestrate.registerWorkflow('test', { steps: [] });
      }).toThrow('must have a non-empty steps array');
    });

    it('should increment workflowsRegistered stat', () => {
      orchestrate.registerWorkflow('w1', { steps: ['step 1'] });
      orchestrate.registerWorkflow('w2', { steps: ['step 1'] });

      expect(orchestrate.getStats().workflowsRegistered).toBe(2);
    });
  });

  describe('getWorkflow', () => {
    it('should return workflow definition', () => {
      orchestrate.registerWorkflow('test', {
        description: 'Test workflow',
        steps: ['Step 1', 'Step 2'],
        parameters: { name: { type: 'string' } },
        maxSteps: 10,
      });

      const w = orchestrate.getWorkflow('test');
      expect(w.description).toBe('Test workflow');
      expect(w.steps).toEqual(['Step 1', 'Step 2']);
      expect(w.parameters).toEqual({ name: { type: 'string' } });
      expect(w.maxSteps).toBe(10);
    });

    it('should return null for non-existent workflow', () => {
      expect(orchestrate.getWorkflow('nope')).toBeNull();
    });
  });

  describe('removeWorkflow', () => {
    it('should remove a registered workflow', () => {
      orchestrate.registerWorkflow('test', { steps: ['step'] });
      orchestrate.removeWorkflow('test');

      expect(orchestrate.hasWorkflow('test')).toBe(false);
    });

    it('should not throw for non-existent workflow', () => {
      expect(() => orchestrate.removeWorkflow('nope')).not.toThrow();
    });
  });

  describe('getWorkflowNames', () => {
    it('should return empty array initially', () => {
      expect(orchestrate.getWorkflowNames()).toEqual([]);
    });

    it('should return registered workflow names', () => {
      orchestrate.registerWorkflow('w1', { steps: ['s'] });
      orchestrate.registerWorkflow('w2', { steps: ['s'] });

      expect(orchestrate.getWorkflowNames()).toEqual(['w1', 'w2']);
    });
  });

  describe('executeWorkflow', () => {
    beforeEach(() => {
      orchestrate.registerWorkflow('register-user', {
        description: 'Register a new user in the system',
        steps: [
          'Navigate to the Customers section',
          'Click the "Add Customer" button',
          'Type "{{name}}" into the name field',
          'Type "{{email}}" into the email field',
          'Click Submit',
        ],
        parameters: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
        },
      });
    });

    it('should execute workflow via agent and yield steps', async () => {
      const steps = await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'juan@test.com',
        }),
      );

      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('thinking');
      expect(steps[1].type).toBe('done');
    });

    it('should pass interpolated goal to agent', async () => {
      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan Pérez',
          email: 'juan@test.com',
        }),
      );

      const agentGoal = mockAgent.run.mock.calls[0][0];
      expect(agentGoal).toContain('Type "Juan Pérez" into the name field');
      expect(agentGoal).toContain('Type "juan@test.com" into the email field');
      expect(agentGoal).toContain('WORKFLOW: Register a new user');
      expect(agentGoal).toContain('STEPS:');
      expect(agentGoal).toContain('[DONE]');
    });

    it('should throw for unregistered workflow', async () => {
      await expect(
        collectSteps(orchestrate.executeWorkflow('nonexistent', {})),
      ).rejects.toThrow("Workflow 'nonexistent' is not registered");
    });

    it('should throw when required parameter is missing', async () => {
      await expect(
        collectSteps(orchestrate.executeWorkflow('register-user', { name: 'Juan' })),
      ).rejects.toThrow("requires parameter 'email'");
    });

    it('should throw when required parameter is null', async () => {
      await expect(
        collectSteps(orchestrate.executeWorkflow('register-user', { name: 'Juan', email: null })),
      ).rejects.toThrow("requires parameter 'email'");
    });

    it('should pass maxSteps from workflow config', async () => {
      orchestrate.registerWorkflow('simple', {
        steps: ['Do thing'],
        maxSteps: 5,
      });

      await collectSteps(orchestrate.executeWorkflow('simple', {}));

      const agentOptions = mockAgent.run.mock.calls[0][1];
      expect(agentOptions.maxSteps).toBe(5);
    });

    it('should use low temperature (0.2) by default', async () => {
      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }),
      );

      const agentOptions = mockAgent.run.mock.calls[0][1];
      expect(agentOptions.temperature).toBe(0.2);
    });

    it('should forward onStep callback', async () => {
      const onStep = vi.fn();

      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }, { onStep }),
      );

      expect(onStep).toHaveBeenCalledTimes(2);
      expect(onStep.mock.calls[0][0].step).toBe(1);
      expect(onStep.mock.calls[1][0].step).toBe(2);
    });

    it('should forward shouldContinue callback', async () => {
      const shouldContinue = vi.fn(() => true);

      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }, { shouldContinue }),
      );

      const agentOptions = mockAgent.run.mock.calls[0][1];
      expect(agentOptions.shouldContinue).toBe(shouldContinue);
    });

    it('should forward abort signal', async () => {
      const controller = new AbortController();

      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }, { signal: controller.signal }),
      );

      const agentOptions = mockAgent.run.mock.calls[0][1];
      expect(agentOptions.signal).toBe(controller.signal);
    });

    it('should emit ai:workflow:start event', async () => {
      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }),
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:workflow:start',
        expect.objectContaining({
          workflow: 'register-user',
          params: { name: 'Juan', email: 'j@t.com' },
          steps: 5,
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should emit ai:workflow:done event', async () => {
      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }),
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:workflow:done',
        expect.objectContaining({
          workflow: 'register-user',
          totalSteps: 2,
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should increment workflowsExecuted stat', async () => {
      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }),
      );

      expect(orchestrate.getStats().workflowsExecuted).toBe(1);
    });

    it('should throw if agent module is not available', async () => {
      const noAgent = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: mockEventBus,
        agent: null,
      });
      noAgent.registerWorkflow('test', { steps: ['step'] });

      await expect(
        collectSteps(noAgent.executeWorkflow('test', {})),
      ).rejects.toThrow('Agent module not available');
    });

    it('should include capability map in workflow goal', async () => {
      orchestrate.register('orders', 'getRecent', {
        description: 'Get recent orders',
        handler: async () => [],
      });

      await collectSteps(
        orchestrate.executeWorkflow('register-user', {
          name: 'Juan',
          email: 'j@t.com',
        }),
      );

      const goal = mockAgent.run.mock.calls[0][0];
      expect(goal).toContain('orders:getRecent');
      expect(goal).toContain('AVAILABLE APP CAPABILITIES');
    });

    it('should work with optional parameters', async () => {
      orchestrate.registerWorkflow('greet', {
        description: 'Greet someone',
        steps: ['Say hello to {{name}}, age {{age}}'],
        parameters: {
          name: { type: 'string', required: true },
          age: { type: 'number' }, // not required
        },
      });

      // Should not throw even though age is not provided
      await collectSteps(
        orchestrate.executeWorkflow('greet', { name: 'Juan' }),
      );

      const goal = mockAgent.run.mock.calls[0][0];
      expect(goal).toContain('Say hello to Juan, age {{age}}');
    });

    it('should use provider from workflow config', async () => {
      orchestrate.registerWorkflow('pro', {
        steps: ['step'],
        provider: 'anthropic',
      });

      await collectSteps(orchestrate.executeWorkflow('pro', {}));

      const opts = mockAgent.run.mock.calls[0][1];
      expect(opts.provider).toBe('anthropic');
    });

    it('should allow provider override per execution', async () => {
      orchestrate.registerWorkflow('pro', {
        steps: ['step'],
        provider: 'anthropic',
      });

      await collectSteps(
        orchestrate.executeWorkflow('pro', {}, { provider: 'openai' }),
      );

      const opts = mockAgent.run.mock.calls[0][1];
      expect(opts.provider).toBe('openai');
    });
  });

  // ── Destroy with workflows ──

  describe('destroy with workflows', () => {
    it('should clear workflows on destroy', () => {
      orchestrate.registerWorkflow('w1', { steps: ['s'] });
      orchestrate.destroy();

      expect(orchestrate.hasWorkflow('w1')).toBe(false);
      expect(orchestrate.getWorkflowNames()).toEqual([]);
    });

    it('should reset workflow stats on destroy', async () => {
      orchestrate.registerWorkflow('w1', { steps: ['s'] });
      await collectSteps(orchestrate.executeWorkflow('w1', {}));

      orchestrate.destroy();

      expect(orchestrate.getStats().workflowsRegistered).toBe(0);
      expect(orchestrate.getStats().workflowsExecuted).toBe(0);
    });
  });

  // ── Mode Auto-Detection ──

  describe('workflow mode detection', () => {
    it('should auto-detect "ai" mode for string steps', () => {
      orchestrate.registerWorkflow('ai-flow', {
        steps: ['Navigate to orders', 'Click button'],
      });

      expect(orchestrate.getWorkflow('ai-flow').mode).toBe('ai');
    });

    it('should auto-detect "deterministic" mode for object steps with action', () => {
      orchestrate.registerWorkflow('det-flow', {
        steps: [
          { action: 'click', selector: '#btn' },
          { action: 'type', selector: '#input', value: 'hello' },
        ],
      });

      expect(orchestrate.getWorkflow('det-flow').mode).toBe('deterministic');
    });

    it('should respect explicit mode override', () => {
      orchestrate.registerWorkflow('forced-ai', {
        mode: 'ai',
        steps: [
          { action: 'click', selector: '#btn' },
        ],
      });

      expect(orchestrate.getWorkflow('forced-ai').mode).toBe('ai');
    });
  });

  // ── Deterministic Workflows ──

  describe('deterministic workflow execution', () => {
    let mockStore;
    let detOrch;

    beforeEach(() => {
      mockStore = {
        get: vi.fn(),
        set: vi.fn(),
      };

      detOrch = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: mockEventBus,
        agent: mockAgent,
        store: mockStore,
      });
    });

    it('should execute click steps', async () => {
      detOrch.registerWorkflow('click-flow', {
        steps: [
          { action: 'click', selector: '#submit-btn' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('click-flow'));

      // step + done
      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Clicked');
      expect(steps[0].content).toContain('#submit-btn');
      expect(steps[0].step).toBe(1);
      expect(steps[1].type).toBe('done');
    });

    it('should execute type steps', async () => {
      detOrch.registerWorkflow('type-flow', {
        steps: [
          { action: 'type', selector: '#name-input', value: 'Juan' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('type-flow'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Typed');
      expect(steps[0].content).toContain('Juan');
      expect(steps[0].content).toContain('#name-input');
    });

    it('should execute navigate steps with section', async () => {
      detOrch.registerWorkflow('nav-flow', {
        steps: [
          { action: 'navigate', section: 'customers' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('nav-flow'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Navigated to section: customers');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'nav:section',
        { section: 'customers' },
        { appName: 'wu-ai' },
      );
    });

    it('should execute navigate steps with selector fallback', async () => {
      detOrch.registerWorkflow('nav-click', {
        steps: [
          { action: 'navigate', selector: '#nav-customers' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('nav-click'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Navigated via click');
    });

    it('should fail navigate when neither section nor selector provided', async () => {
      detOrch.registerWorkflow('nav-bad', {
        steps: [
          { action: 'navigate' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('nav-bad'));

      expect(steps[0].type).toBe('error');
      expect(steps[0].content).toContain('requires "section" or "selector"');
    });

    it('should execute emit steps', async () => {
      detOrch.registerWorkflow('emit-flow', {
        steps: [
          { action: 'emit', event: 'order:new', data: { id: 123 } },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('emit-flow'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Emitted: order:new');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'order:new',
        { id: 123 },
        { appName: 'wu-ai' },
      );
    });

    it('should execute setState steps', async () => {
      detOrch.registerWorkflow('state-flow', {
        steps: [
          { action: 'setState', path: 'user.name', value: 'Juan' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('state-flow'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Set state: user.name');
      expect(mockStore.set).toHaveBeenCalledWith('user.name', 'Juan');
    });

    it('should fail setState if store not available', async () => {
      const noStore = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: mockEventBus,
        agent: mockAgent,
        store: null,
      });

      noStore.registerWorkflow('state-no-store', {
        steps: [
          { action: 'setState', path: 'x', value: 1 },
        ],
      });

      const steps = await collectSteps(noStore.executeWorkflow('state-no-store'));

      expect(steps[0].type).toBe('error');
      expect(steps[0].content).toContain('store not available');
    });

    it('should fail emit if eventBus not available', async () => {
      const noEv = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: null,
        agent: mockAgent,
        store: mockStore,
      });

      noEv.registerWorkflow('emit-no-bus', {
        steps: [
          { action: 'emit', event: 'test', data: {} },
        ],
      });

      const steps = await collectSteps(noEv.executeWorkflow('emit-no-bus'));

      expect(steps[0].type).toBe('error');
      expect(steps[0].content).toContain('eventBus not available');
    });

    it('should handle unknown actions', async () => {
      detOrch.registerWorkflow('unknown-flow', {
        steps: [
          { action: 'dance', selector: '#stage' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('unknown-flow'));

      expect(steps[0].type).toBe('error');
      expect(steps[0].content).toContain('Unknown action: dance');
    });

    it('should execute wait with ms delay', async () => {
      detOrch.registerWorkflow('wait-flow', {
        steps: [
          { action: 'wait', ms: 50 },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('wait-flow'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('Waited 50ms');
    });

    it('should execute wait with selector (found immediately)', async () => {
      // Create element in jsdom
      const el = document.createElement('div');
      el.id = 'test-found';
      document.body.appendChild(el);

      detOrch.registerWorkflow('wait-sel', {
        steps: [
          { action: 'wait', selector: '#test-found', timeout: 500 },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('wait-sel'));

      expect(steps[0].type).toBe('action');
      expect(steps[0].content).toContain('found');

      document.body.removeChild(el);
    });

    it('should timeout wait with selector not found', async () => {
      detOrch.registerWorkflow('wait-timeout', {
        steps: [
          { action: 'wait', selector: '#does-not-exist', timeout: 300 },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('wait-timeout'));

      expect(steps[0].type).toBe('error');
      expect(steps[0].content).toContain('Timeout');
    });

    it('should interpolate parameters into step values', async () => {
      detOrch.registerWorkflow('param-flow', {
        steps: [
          { action: 'type', selector: '#name', value: '{{name}}' },
          { action: 'type', selector: '#email', value: '{{email}}' },
        ],
        parameters: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
        },
      });

      const steps = await collectSteps(
        detOrch.executeWorkflow('param-flow', {
          name: 'Ana García',
          email: 'ana@test.com',
        }),
      );

      // Check that parameters were interpolated
      expect(steps[0].content).toContain('Ana García');
      expect(steps[1].content).toContain('ana@test.com');
    });

    it('should interpolate parameters in selector field', async () => {
      detOrch.registerWorkflow('sel-param', {
        steps: [
          { action: 'click', selector: '#row-{{id}}' },
        ],
        parameters: {
          id: { type: 'string', required: true },
        },
      });

      const steps = await collectSteps(
        detOrch.executeWorkflow('sel-param', { id: '42' }),
      );

      expect(steps[0].content).toContain('#row-42');
    });

    it('should execute multiple steps in sequence', async () => {
      detOrch.registerWorkflow('multi-step', {
        steps: [
          { action: 'navigate', section: 'customers' },
          { action: 'click', selector: '#add-btn' },
          { action: 'type', selector: '#name', value: 'Test' },
          { action: 'click', selector: '#save-btn' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('multi-step'));

      // 4 action steps + 1 done
      expect(steps).toHaveLength(5);
      expect(steps[0].step).toBe(1);
      expect(steps[1].step).toBe(2);
      expect(steps[2].step).toBe(3);
      expect(steps[3].step).toBe(4);
      expect(steps[4].type).toBe('done');
      expect(steps[4].content).toContain('4 steps');
    });

    it('should stop on first error', async () => {
      detOrch.registerWorkflow('error-flow', {
        steps: [
          { action: 'click', selector: '#ok-btn' },
          { action: 'click', selector: '#fail' }, // mocked to fail
          { action: 'click', selector: '#never-reached' },
        ],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('error-flow'));

      // step 1 (success) + step 2 (error) — no step 3, no done
      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('action');
      expect(steps[1].type).toBe('error');
      expect(steps[1].content).toContain('#fail');
    });

    it('should call onStep callback for each step', async () => {
      const onStep = vi.fn();

      detOrch.registerWorkflow('cb-flow', {
        steps: [
          { action: 'click', selector: '#btn1' },
          { action: 'click', selector: '#btn2' },
        ],
      });

      await collectSteps(
        detOrch.executeWorkflow('cb-flow', {}, { onStep }),
      );

      // 2 action steps + 1 done = 3 calls
      expect(onStep).toHaveBeenCalledTimes(3);
      expect(onStep.mock.calls[0][0].step).toBe(1);
      expect(onStep.mock.calls[1][0].step).toBe(2);
      expect(onStep.mock.calls[2][0].type).toBe('done');
    });

    it('should respect shouldContinue callback (stop mid-flow)', async () => {
      const shouldContinue = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // stop after step 2

      detOrch.registerWorkflow('gate-flow', {
        steps: [
          { action: 'click', selector: '#btn1' },
          { action: 'click', selector: '#btn2' },
          { action: 'click', selector: '#btn3' },
        ],
      });

      const steps = await collectSteps(
        detOrch.executeWorkflow('gate-flow', {}, { shouldContinue }),
      );

      // step 1 + step 2 + interrupted (no step 3, no done)
      expect(steps).toHaveLength(3);
      expect(steps[0].type).toBe('action');
      expect(steps[1].type).toBe('action');
      expect(steps[2].type).toBe('interrupted');
      expect(steps[2].content).toContain('Stopped by user');
    });

    it('should handle shouldContinue throwing as false', async () => {
      const shouldContinue = vi.fn().mockRejectedValue(new Error('oops'));

      detOrch.registerWorkflow('gate-err', {
        steps: [
          { action: 'click', selector: '#btn1' },
          { action: 'click', selector: '#btn2' },
        ],
      });

      const steps = await collectSteps(
        detOrch.executeWorkflow('gate-err', {}, { shouldContinue }),
      );

      // step 1 + interrupted (shouldContinue threw on step 1)
      expect(steps).toHaveLength(2);
      expect(steps[1].type).toBe('interrupted');
    });

    it('should respect abort signal', async () => {
      const controller = new AbortController();
      controller.abort(); // abort immediately

      detOrch.registerWorkflow('abort-flow', {
        steps: [
          { action: 'click', selector: '#btn1' },
        ],
      });

      const steps = await collectSteps(
        detOrch.executeWorkflow('abort-flow', {}, { signal: controller.signal }),
      );

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('aborted');
      expect(steps[0].content).toContain('aborted');
    });

    it('should emit ai:workflow:start with mode=deterministic', async () => {
      detOrch.registerWorkflow('det-ev', {
        steps: [
          { action: 'click', selector: '#x' },
        ],
      });

      await collectSteps(detOrch.executeWorkflow('det-ev'));

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:workflow:start',
        expect.objectContaining({
          workflow: 'det-ev',
          mode: 'deterministic',
          steps: 1,
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should emit ai:workflow:done with mode=deterministic', async () => {
      detOrch.registerWorkflow('det-done', {
        steps: [
          { action: 'click', selector: '#x' },
        ],
      });

      await collectSteps(detOrch.executeWorkflow('det-done'));

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:workflow:done',
        expect.objectContaining({
          workflow: 'det-done',
          mode: 'deterministic',
          result: 'done',
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should emit ai:workflow:done even on error', async () => {
      detOrch.registerWorkflow('det-err-ev', {
        steps: [
          { action: 'click', selector: '#fail' },
        ],
      });

      await collectSteps(detOrch.executeWorkflow('det-err-ev'));

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'ai:workflow:done',
        expect.objectContaining({
          workflow: 'det-err-ev',
          result: 'error',
        }),
        { appName: 'wu-ai' },
      );
    });

    it('should validate required parameters in deterministic mode too', async () => {
      detOrch.registerWorkflow('det-param', {
        steps: [
          { action: 'type', selector: '#name', value: '{{name}}' },
        ],
        parameters: {
          name: { type: 'string', required: true },
        },
      });

      await expect(
        collectSteps(detOrch.executeWorkflow('det-param', {})),
      ).rejects.toThrow("requires parameter 'name'");
    });

    it('should not use agent for deterministic workflows', async () => {
      detOrch.registerWorkflow('no-agent', {
        steps: [
          { action: 'click', selector: '#btn' },
        ],
      });

      await collectSteps(detOrch.executeWorkflow('no-agent'));

      // Agent.run should NOT have been called
      expect(mockAgent.run).not.toHaveBeenCalled();
    });

    it('should work even without agent module', async () => {
      const noAgentOrch = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: mockEventBus,
        agent: null,
        store: mockStore,
      });

      noAgentOrch.registerWorkflow('det-no-agent', {
        steps: [
          { action: 'click', selector: '#btn' },
          { action: 'emit', event: 'test:done', data: {} },
        ],
      });

      const steps = await collectSteps(noAgentOrch.executeWorkflow('det-no-agent'));

      // Works fine — 2 action steps + done
      expect(steps).toHaveLength(3);
      expect(steps[2].type).toBe('done');
    });

    it('should increment workflowsExecuted stat', async () => {
      detOrch.registerWorkflow('det-stat', {
        steps: [{ action: 'click', selector: '#x' }],
      });

      await collectSteps(detOrch.executeWorkflow('det-stat'));

      expect(detOrch.getStats().workflowsExecuted).toBe(1);
    });

    it('should include elapsed time in step results', async () => {
      detOrch.registerWorkflow('det-elapsed', {
        steps: [{ action: 'click', selector: '#x' }],
      });

      const steps = await collectSteps(detOrch.executeWorkflow('det-elapsed'));

      expect(typeof steps[0].elapsed).toBe('number');
      expect(steps[0].elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Integration with WuAI orchestrator ──

  describe('WuAI integration', () => {
    it('should be usable via the orchestrator pattern', () => {
      const instance = new WuAIOrchestrate({
        actions,
        conversation,
        context,
        permissions,
        eventBus: mockEventBus,
        agent: mockAgent,
      });

      expect(instance).toBeDefined();
      expect(typeof instance.register).toBe('function');
      expect(typeof instance.resolve).toBe('function');
      expect(typeof instance.removeApp).toBe('function');
      expect(typeof instance.registerWorkflow).toBe('function');
      expect(typeof instance.executeWorkflow).toBe('function');
      expect(typeof instance.configure).toBe('function');
      expect(typeof instance.getStats).toBe('function');
      expect(typeof instance.destroy).toBe('function');
    });
  });
});
