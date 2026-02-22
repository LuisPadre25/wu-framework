import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIConversation } from '../../src/ai/wu-ai-conversation.js';
import { WuAIPermissions } from '../../src/ai/wu-ai-permissions.js';
import { WuAIActions } from '../../src/ai/wu-ai-actions.js';
import { WuAIContext } from '../../src/ai/wu-ai-context.js';

describe('WuAIConversation', () => {
  let conversation;
  let mockProvider;
  let actions;
  let context;
  let permissions;
  let mockEventBus;
  let mockStore;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    mockStore = { get: vi.fn(), set: vi.fn() };

    permissions = new WuAIPermissions({
      rateLimit: { requestsPerMinute: 100, maxConcurrent: 10 },
    });

    actions = new WuAIActions({
      eventBus: mockEventBus,
      store: mockStore,
      permissions,
    });

    context = new WuAIContext({
      store: mockStore,
      eventBus: mockEventBus,
      core: null,
    });

    mockProvider = {
      send: vi.fn(),
      stream: vi.fn(),
    };

    conversation = new WuAIConversation({
      provider: mockProvider,
      actions,
      context,
      permissions,
      eventBus: mockEventBus,
    });
  });

  // ── Send ──

  describe('send', () => {
    it('should send a message and return response', async () => {
      mockProvider.send.mockResolvedValue({
        content: 'Hello from AI!',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await conversation.send('Hello');
      expect(result.content).toBe('Hello from AI!');
      expect(result.namespace).toBe('default');
      expect(result.usage).toBeDefined();
    });

    it('should maintain conversation history', async () => {
      mockProvider.send.mockResolvedValue({ content: 'Response 1' });
      await conversation.send('Message 1');

      mockProvider.send.mockResolvedValue({ content: 'Response 2' });
      await conversation.send('Message 2');

      const history = conversation.getHistory('default');
      // system + user1 + assistant1 + user2 + assistant2
      expect(history.length).toBeGreaterThanOrEqual(4);
    });

    it('should use separate namespaces', async () => {
      mockProvider.send.mockResolvedValue({ content: 'Chat response' });
      await conversation.send('Chat message', { namespace: 'chat' });

      mockProvider.send.mockResolvedValue({ content: 'Admin response' });
      await conversation.send('Admin message', { namespace: 'admin' });

      expect(conversation.getHistory('chat').length).toBeGreaterThan(0);
      expect(conversation.getHistory('admin').length).toBeGreaterThan(0);
      expect(conversation.getNamespaces()).toContain('chat');
      expect(conversation.getNamespaces()).toContain('admin');
    });

    it('should block when preflight fails', async () => {
      permissions.circuitBreaker.configure({ maxFailures: 1, cooldownMs: 60000 });
      permissions.circuitBreaker.recordFailure();

      const result = await conversation.send('blocked message');
      expect(result.content).toContain('[blocked]');
    });

    it('should handle tool calls', async () => {
      actions.register('getTime', {
        description: 'Get current time',
        handler: async () => new Date().toISOString(),
      });

      // First call returns tool_call, second returns final response
      mockProvider.send
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [{ id: 'tc1', name: 'getTime', arguments: {} }],
        })
        .mockResolvedValueOnce({
          content: 'The time is now.',
        });

      const result = await conversation.send('What time is it?');
      expect(result.content).toBe('The time is now.');
      expect(result.tool_results).toHaveLength(1);
      expect(result.tool_results[0].tool).toBe('getTime');
      expect(result.tool_results[0].success).toBe(true);
    });

    it('should limit tool call rounds', async () => {
      conversation.configure({ maxToolRounds: 2 });

      actions.register('loop', {
        handler: async () => 'looped',
      });

      // Always return tool calls → infinite loop protection
      mockProvider.send.mockResolvedValue({
        content: '',
        tool_calls: [{ id: 'tc', name: 'loop', arguments: {} }],
      });

      const result = await conversation.send('Loop me');
      expect(result.content).toContain('loop limit');
    });
  });

  // ── Stream ──

  describe('stream', () => {
    it('should yield text chunks', async () => {
      mockProvider.stream = async function* () {
        yield { type: 'text', content: 'Hello ' };
        yield { type: 'text', content: 'world!' };
        yield { type: 'done' };
      };

      const chunks = [];
      for await (const chunk of conversation.stream('Hi')) {
        chunks.push(chunk);
      }

      expect(chunks.filter(c => c.type === 'text')).toHaveLength(2);
      expect(chunks.find(c => c.type === 'done')).toBeDefined();
    });

    it('should handle stream errors', async () => {
      mockProvider.stream = async function* () {
        yield { type: 'text', content: 'start' };
        throw new Error('stream broke');
      };

      const chunks = [];
      for await (const chunk of conversation.stream('Hi')) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === 'error')).toBe(true);
    });

    it('should block when preflight fails', async () => {
      permissions.circuitBreaker.configure({ maxFailures: 1, cooldownMs: 60000 });
      permissions.circuitBreaker.recordFailure();

      const chunks = [];
      for await (const chunk of conversation.stream('blocked')) {
        chunks.push(chunk);
      }
      expect(chunks[0].type).toBe('error');
    });
  });

  // ── History Management ──

  describe('history management', () => {
    it('should clear history for a namespace', async () => {
      mockProvider.send.mockResolvedValue({ content: 'ok' });
      await conversation.send('msg', { namespace: 'test' });
      expect(conversation.getHistory('test').length).toBeGreaterThan(0);

      conversation.clear('test');
      expect(conversation.getHistory('test')).toHaveLength(0);
    });

    it('should clear all namespaces', async () => {
      mockProvider.send.mockResolvedValue({ content: 'ok' });
      await conversation.send('msg1', { namespace: 'a' });
      await conversation.send('msg2', { namespace: 'b' });

      conversation.clearAll();
      expect(conversation.getHistory('a')).toHaveLength(0);
      expect(conversation.getHistory('b')).toHaveLength(0);
    });

    it('should inject messages manually', () => {
      conversation.inject('user', 'injected message', { namespace: 'test' });
      const history = conversation.getHistory('test');
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('injected message');
    });

    it('should delete namespaces', async () => {
      mockProvider.send.mockResolvedValue({ content: 'ok' });
      await conversation.send('msg', { namespace: 'temp' });
      expect(conversation.getNamespaces()).toContain('temp');

      conversation.deleteNamespace('temp');
      expect(conversation.getNamespaces()).not.toContain('temp');
    });
  });

  // ── Abort ──

  describe('abort', () => {
    it('should not throw when aborting non-existent namespace', () => {
      expect(() => conversation.abort('nonexistent')).not.toThrow();
    });

    it('should abort all namespaces', async () => {
      mockProvider.send.mockResolvedValue({ content: 'ok' });
      await conversation.send('msg', { namespace: 'a' });
      expect(() => conversation.abortAll()).not.toThrow();
    });
  });

  // ── Stats ──

  describe('getStats', () => {
    it('should return conversation stats', async () => {
      mockProvider.send.mockResolvedValue({ content: 'ok' });
      await conversation.send('msg', { namespace: 'test' });

      const stats = conversation.getStats();
      expect(stats.namespaces).toHaveProperty('test');
      expect(stats.namespaces.test.messageCount).toBeGreaterThan(0);
    });
  });
});
