import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIContext } from '../../src/ai/wu-ai-context.js';

describe('WuAIContext', () => {
  let context;
  let mockStore;
  let mockEventBus;
  let mockCore;

  beforeEach(() => {
    mockStore = {
      get: vi.fn((path) => {
        const data = { 'user.name': 'Joe', 'cart.items': [1, 2, 3] };
        return data[path];
      }),
    };
    mockEventBus = {
      history: [
        { name: 'user:login', data: { userId: 1 }, timestamp: 1000 },
        { name: 'cart:updated', data: { items: 3 }, timestamp: 2000 },
        { name: 'nav:changed', data: { path: '/home' }, timestamp: 3000 },
      ],
    };
    mockCore = {
      mounted: new Map([['app1', {}], ['app2', {}]]),
    };

    context = new WuAIContext({
      store: mockStore,
      eventBus: mockEventBus,
      core: mockCore,
    });
  });

  // ── Configuration ──

  describe('configure', () => {
    it('should set budget', () => {
      context.configure({ budget: 8000 });
      expect(context.getStats().budget).toBe(8000);
    });

    it('should set store paths', () => {
      context.configure({ sources: { store: { include: ['user.name'] } } });
      expect(context.getStats().storePaths).toContain('user.name');
    });
  });

  // ── Collection ──

  describe('collect', () => {
    it('should collect mounted apps', async () => {
      const snapshot = await context.collect();
      expect(snapshot._mountedApps).toEqual(['app1', 'app2']);
    });

    it('should collect store data for configured paths', async () => {
      context.configure({ sources: { store: { include: ['user.name', 'cart.items'] } } });
      const snapshot = await context.collect();
      expect(snapshot._store['user.name']).toBe('Joe');
      expect(snapshot._store['cart.items']).toEqual([1, 2, 3]);
    });

    it('should not collect store if no paths configured', async () => {
      const snapshot = await context.collect();
      expect(snapshot._store).toBeUndefined();
    });

    it('should collect events matching patterns', async () => {
      context.configure({ sources: { events: { include: ['cart:*'], lastN: 5 } } });
      const snapshot = await context.collect();
      expect(snapshot._events).toHaveLength(1);
      expect(snapshot._events[0].event).toBe('cart:updated');
    });

    it('should collect custom sources', async () => {
      context.configure({
        sources: {
          custom: [
            { key: 'version', value: '1.0', priority: 'low' },
            { key: 'dynamic', value: () => 'computed', priority: 'medium' },
          ],
        },
      });
      const snapshot = await context.collect();
      expect(snapshot.version).toBe('1.0');
      expect(snapshot.dynamic).toBe('computed');
    });

    it('should handle failing custom collectors gracefully', async () => {
      context.configure({
        sources: {
          custom: [{ key: 'broken', value: () => { throw new Error('fail'); } }],
        },
      });
      const snapshot = await context.collect();
      expect(snapshot.broken).toBeUndefined();
    });
  });

  // ── Registered Collectors ──

  describe('register', () => {
    it('should register and run named collectors', async () => {
      context.register('analytics', {
        collector: async () => ({ pageViews: 42 }),
        priority: 'high',
      });

      const snapshot = await context.collect();
      expect(snapshot.analytics).toEqual({ pageViews: 42 });
    });

    it('should handle failing registered collectors', async () => {
      context.register('broken', {
        collector: async () => { throw new Error('nope'); },
      });

      const snapshot = await context.collect();
      expect(snapshot.broken).toBeUndefined();
    });
  });

  // ── System Prompt ──

  describe('toSystemPrompt', () => {
    it('should return base prompt when no snapshot', () => {
      const prompt = context.toSystemPrompt();
      expect(prompt).toContain('AI assistant');
      expect(prompt).toContain('Wu Framework');
    });

    it('should include mounted apps', async () => {
      await context.collect();
      const prompt = context.toSystemPrompt();
      expect(prompt).toContain('app1');
      expect(prompt).toContain('app2');
    });

    it('should include store state', async () => {
      context.configure({ sources: { store: { include: ['user.name'] } } });
      await context.collect();
      const prompt = context.toSystemPrompt();
      expect(prompt).toContain('APPLICATION STATE');
      expect(prompt).toContain('Joe');
    });

    it('should include tools in prompt', async () => {
      await context.collect();
      const prompt = context.toSystemPrompt({
        tools: [{ name: 'search', description: 'Search items' }],
      });
      expect(prompt).toContain('AVAILABLE TOOLS');
      expect(prompt).toContain('search');
    });

    it('should respect token budget', async () => {
      context.configure({ budget: 10, charRatio: 4 }); // 40 chars budget
      context.configure({ sources: { store: { include: ['user.name', 'cart.items'] } } });
      await context.collect();
      const prompt = context.toSystemPrompt();
      // Should be constrained (budget is very small)
      expect(prompt.length).toBeLessThan(1000);
    });
  });

  // ── Interpolation Context ──

  describe('getInterpolationContext', () => {
    it('should return empty object when no snapshot', () => {
      expect(context.getInterpolationContext()).toEqual({});
    });

    it('should return simplified context', async () => {
      context.configure({ sources: { store: { include: ['user.name'] } } });
      await context.collect();
      const ctx = context.getInterpolationContext();
      expect(ctx.apps).toEqual(['app1', 'app2']);
      expect(ctx.store).toHaveProperty('user.name');
    });
  });

  // ── Pattern Matching ──

  describe('_matchPattern', () => {
    it('should match exact events', () => {
      expect(context._matchPattern('cart:updated', 'cart:updated')).toBe(true);
      expect(context._matchPattern('cart:updated', 'cart:deleted')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(context._matchPattern('cart:updated', 'cart:*')).toBe(true);
      expect(context._matchPattern('user:login', 'cart:*')).toBe(false);
    });

    it('should match global wildcard', () => {
      expect(context._matchPattern('anything', '*')).toBe(true);
    });

    it('should handle null/undefined', () => {
      expect(context._matchPattern(null, 'cart:*')).toBe(false);
      expect(context._matchPattern('cart:x', null)).toBe(false);
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return stats', () => {
      const stats = context.getStats();
      expect(stats).toHaveProperty('budget');
      expect(stats).toHaveProperty('collectors');
      expect(stats).toHaveProperty('storePaths');
      expect(stats).toHaveProperty('lastCollected');
    });
  });
});
