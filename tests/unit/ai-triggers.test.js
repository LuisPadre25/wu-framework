import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAITriggers } from '../../src/ai/wu-ai-triggers.js';
import { WuAIPermissions } from '../../src/ai/wu-ai-permissions.js';

describe('WuAITriggers', () => {
  let triggers;
  let mockEventBus;
  let mockConversation;
  let permissions;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = new Map();
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn((pattern, handler) => {
        if (!eventHandlers.has(pattern)) eventHandlers.set(pattern, []);
        eventHandlers.get(pattern).push(handler);
        return () => {
          const handlers = eventHandlers.get(pattern) || [];
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        };
      }),
      off: vi.fn(),
    };

    mockConversation = {
      send: vi.fn().mockResolvedValue({ content: 'AI response', namespace: 'trigger:test' }),
    };

    permissions = new WuAIPermissions();

    triggers = new WuAITriggers({
      eventBus: mockEventBus,
      conversation: mockConversation,
      permissions,
    });
  });

  // ── Registration ──

  describe('register', () => {
    it('should register a trigger', () => {
      triggers.register('test', {
        pattern: 'cart:updated',
        prompt: 'Cart was updated',
      });

      expect(triggers.getNames()).toContain('test');
      expect(mockEventBus.on).toHaveBeenCalledWith('cart:updated', expect.any(Function));
    });

    it('should unregister a trigger', () => {
      triggers.register('temp', {
        pattern: 'test:event',
        prompt: 'Test',
      });

      triggers.unregister('temp');
      expect(triggers.getNames()).not.toContain('temp');
    });

    it('should replace existing trigger with same name', () => {
      triggers.register('dup', { pattern: 'a:*', prompt: 'A' });
      triggers.register('dup', { pattern: 'b:*', prompt: 'B' });

      const info = triggers.getTrigger('dup');
      expect(info.pattern).toBe('b:*');
    });

    it('should respect maxActiveTriggers', () => {
      triggers.configure({ maxActiveTriggers: 2 });
      triggers.register('t1', { pattern: 'a', prompt: 'a' });
      triggers.register('t2', { pattern: 'b', prompt: 'b' });
      triggers.register('t3', { pattern: 'c', prompt: 'c' }); // should be blocked

      expect(triggers.getNames()).toHaveLength(2);
    });
  });

  // ── Trigger Info ──

  describe('getTrigger', () => {
    it('should return trigger info', () => {
      triggers.register('info', {
        pattern: 'user:*',
        prompt: 'User event',
        priority: 'high',
      });

      const info = triggers.getTrigger('info');
      expect(info.name).toBe('info');
      expect(info.pattern).toBe('user:*');
      expect(info.priority).toBe('high');
      expect(info.enabled).toBe(true);
    });

    it('should return null for unknown trigger', () => {
      expect(triggers.getTrigger('unknown')).toBeNull();
    });
  });

  // ── Enable/Disable ──

  describe('enable/disable', () => {
    it('should enable/disable individual trigger', () => {
      triggers.register('toggle', { pattern: 'x', prompt: 'x' });
      triggers.setEnabled('toggle', false);
      expect(triggers.getTrigger('toggle').enabled).toBe(false);

      triggers.setEnabled('toggle', true);
      expect(triggers.getTrigger('toggle').enabled).toBe(true);
    });

    it('should enable/disable all triggers', () => {
      triggers.register('a', { pattern: 'a', prompt: 'a' });
      triggers.register('b', { pattern: 'b', prompt: 'b' });

      triggers.setAllEnabled(false);
      expect(triggers.getTrigger('a').enabled).toBe(false);
      expect(triggers.getTrigger('b').enabled).toBe(false);
    });
  });

  // ── Manual Fire ──

  describe('fire', () => {
    it('should fire a trigger manually', async () => {
      triggers.register('manual', {
        pattern: 'test:event',
        prompt: 'Test prompt',
      });

      const result = await triggers.fire('manual', { data: 'test' });
      expect(mockConversation.send).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ namespace: 'trigger:manual' }),
      );
      expect(result.content).toBe('AI response');
    });

    it('should return null for unknown trigger', async () => {
      const result = await triggers.fire('unknown');
      expect(result).toBeNull();
    });
  });

  // ── Event Handling ──

  describe('event handling', () => {
    it('should fire on matching event (with debounce=0)', async () => {
      triggers.register('instant', {
        pattern: 'cart:updated',
        prompt: 'Cart updated: {{data}}',
        debounce: 0,
      });

      // Simulate event
      const handlers = eventHandlers.get('cart:updated') || [];
      for (const h of handlers) {
        await h({ data: { items: 3 } });
      }

      // Give async a moment to settle
      await new Promise(r => setTimeout(r, 50));

      expect(mockConversation.send).toHaveBeenCalled();
    });

    it('should skip when condition returns false', async () => {
      triggers.register('conditional', {
        pattern: 'test:event',
        prompt: 'Test',
        condition: (data) => data?.data?.important === true,
        debounce: 0,
      });

      const handlers = eventHandlers.get('test:event') || [];
      for (const h of handlers) {
        await h({ data: { important: false } });
      }

      await new Promise(r => setTimeout(r, 50));
      expect(mockConversation.send).not.toHaveBeenCalled();
    });

    it('should skip when trigger is disabled', async () => {
      triggers.register('disabled', {
        pattern: 'test:event',
        prompt: 'Test',
        debounce: 0,
      });
      triggers.setEnabled('disabled', false);

      const handlers = eventHandlers.get('test:event') || [];
      for (const h of handlers) {
        await h({ data: 'test' });
      }

      await new Promise(r => setTimeout(r, 50));
      expect(mockConversation.send).not.toHaveBeenCalled();
    });
  });

  // ── Prompt Building ──

  describe('prompt building', () => {
    it('should use function prompt', async () => {
      triggers.register('fn-prompt', {
        pattern: 'test',
        prompt: (data) => `Event data: ${JSON.stringify(data)}`,
        debounce: 0,
      });

      await triggers.fire('fn-prompt', { x: 1 });
      expect(mockConversation.send).toHaveBeenCalledWith(
        expect.stringContaining('Event data:'),
        expect.any(Object),
      );
    });
  });

  // ── Callback ──

  describe('onResult callback', () => {
    it('should call onResult with result', async () => {
      const onResult = vi.fn();
      triggers.register('callback', {
        pattern: 'test',
        prompt: 'Test',
        onResult,
      });

      await triggers.fire('callback', { data: 'test' });
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'AI response' }),
        { data: 'test' },
      );
    });
  });

  // ── Destroy ──

  describe('destroy', () => {
    it('should clean up all triggers', () => {
      triggers.register('a', { pattern: 'a', prompt: 'a' });
      triggers.register('b', { pattern: 'b', prompt: 'b' });

      triggers.destroy();
      expect(triggers.getNames()).toHaveLength(0);
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return trigger stats', async () => {
      triggers.register('stat', { pattern: 'x', prompt: 'x' });
      await triggers.fire('stat');

      const stats = triggers.getStats();
      expect(stats.totalFired).toBe(1);
      expect(stats.triggerCount).toBe(1);
      expect(stats.triggers.stat.fireCount).toBe(1);
    });
  });
});
