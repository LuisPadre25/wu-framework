import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WuAIAgent } from '../../src/ai/wu-ai-agent.js';
import { WuAIPermissions } from '../../src/ai/wu-ai-permissions.js';

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Drain all yielded steps from the async generator into an array.
 * This is the fundamental consumption pattern for the agent loop.
 */
async function collectSteps(generator) {
  const steps = [];
  for await (const step of generator) {
    steps.push(step);
  }
  return steps;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('WuAIAgent', () => {
  let agent;
  let conversation;
  let actions;
  let context;
  let permissions;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

    permissions = new WuAIPermissions({
      rateLimit: { requestsPerMinute: 100, maxConcurrent: 10 },
      loopProtection: { maxDepth: 20 },
    });

    conversation = {
      send: vi.fn(),
      clear: vi.fn(),
      deleteNamespace: vi.fn(),
    };

    actions = {
      getToolSchemas: vi.fn(() => [
        {
          name: 'browser_info',
          description: 'Get browser information',
          parameters: { properties: { key: { type: 'string' } } },
        },
      ]),
    };

    context = {
      collect: vi.fn(),
      getSnapshot: vi.fn(() => ({
        _mountedApps: ['shell', 'dashboard'],
        _store: { user: 'test' },
      })),
    };

    agent = new WuAIAgent({
      conversation,
      actions,
      context,
      permissions,
      eventBus: mockEventBus,
    });
  });

  // ── 1. Basic run completes on [DONE] marker ──

  describe('basic run completes', () => {
    it('should stop when response contains [DONE]', async () => {
      conversation.send
        .mockResolvedValueOnce({
          content: 'I will check the data',
          tool_results: [{ name: 'browser_info', result: { browser: 'Chrome' } }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        })
        .mockResolvedValueOnce({
          content: 'Here are the results. [DONE]',
          tool_results: [],
          usage: { prompt_tokens: 80, completion_tokens: 30 },
        });

      const steps = await collectSteps(agent.run('Analyze browser data'));

      // Step 1 yields tool_call, step 2 yields done
      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('tool_call');
      expect(steps[0].step).toBe(1);
      expect(steps[1].type).toBe('done');
      expect(steps[1].step).toBe(2);
      expect(steps[1].content).toBe('Here are the results.');
      expect(steps[1].reason).toContain('DONE');
    });

    it('should emit ai:agent:start and ai:agent:done events', async () => {
      conversation.send.mockResolvedValueOnce({
        content: 'All done. [DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Simple goal'));

      const startCalls = mockEventBus.emit.mock.calls.filter(c => c[0] === 'ai:agent:start');
      const doneCalls = mockEventBus.emit.mock.calls.filter(c => c[0] === 'ai:agent:done');

      expect(startCalls).toHaveLength(1);
      expect(startCalls[0][1].goal).toBe('Simple goal');
      expect(doneCalls).toHaveLength(1);
      expect(doneCalls[0][1].reason).toBe('done');
    });
  });

  // ── 2. Max steps limit ──

  describe('max steps limit', () => {
    it('should stop after maxSteps when LLM never finishes', async () => {
      // LLM always responds with thinking (no tools, no [DONE]) on step 1,
      // then on step 2 we would see tool-call cessation if step 1 had tools.
      // To hit maxSteps, LLM must keep calling tools every step.
      conversation.send.mockResolvedValue({
        content: 'Still working...',
        tool_results: [{ name: 'browser_info', result: {} }],
        usage: {},
      });

      const steps = await collectSteps(agent.run('Infinite goal', { maxSteps: 3 }));

      // 3 tool_call steps + 1 final max-steps done
      expect(steps).toHaveLength(4);
      expect(steps[0].type).toBe('tool_call');
      expect(steps[1].type).toBe('tool_call');
      expect(steps[2].type).toBe('tool_call');
      expect(steps[3].type).toBe('done');
      expect(steps[3].reason).toContain('Max steps');
    });
  });

  // ── 3. No tool calls = implicit done ──

  describe('no tool calls implicit done', () => {
    it('should stop when LLM stops calling tools after previously calling them', async () => {
      // Step 1: has tool calls
      conversation.send.mockResolvedValueOnce({
        content: 'Checking data...',
        tool_results: [{ name: 'browser_info', result: { ok: true } }],
        usage: {},
      });
      // Step 2: no tool calls -> implicit done
      conversation.send.mockResolvedValueOnce({
        content: 'Here is my final analysis.',
        tool_results: [],
        usage: {},
      });

      const steps = await collectSteps(agent.run('Analyze something'));

      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('tool_call');
      expect(steps[1].type).toBe('done');
      expect(steps[1].reason).toContain('no further tool calls');
    });
  });

  // ── 4. Tool call step ──

  describe('tool call step', () => {
    it('should yield tool_call type when response includes tool_results', async () => {
      const toolResults = [
        { name: 'browser_info', result: { userAgent: 'Mozilla/5.0' } },
      ];

      conversation.send
        .mockResolvedValueOnce({
          content: 'Let me check the browser info.',
          tool_results: toolResults,
          usage: { prompt_tokens: 30, completion_tokens: 15 },
        })
        .mockResolvedValueOnce({
          content: 'Done checking. [DONE]',
          tool_results: [],
          usage: {},
        });

      const steps = await collectSteps(agent.run('Get browser info'));

      expect(steps[0].type).toBe('tool_call');
      expect(steps[0].toolResults).toEqual(toolResults);
      expect(steps[0].usage).toEqual({ prompt_tokens: 30, completion_tokens: 15 });
      expect(steps[0].content).toBe('Let me check the browser info.');
    });
  });

  // ── 5. Abort via signal ──

  describe('abort via signal', () => {
    it('should stop when external AbortController fires', async () => {
      const controller = new AbortController();

      // Abort before the loop even starts its first send
      controller.abort();

      const steps = await collectSteps(agent.run('Will be aborted', {
        signal: controller.signal,
      }));

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('aborted');
      expect(steps[0].reason).toContain('Aborted');
    });

    it('should stop when abort fires during LLM call', async () => {
      const controller = new AbortController();

      conversation.send.mockImplementation(() => {
        // Simulate abort happening while the LLM is "thinking"
        controller.abort();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const steps = await collectSteps(agent.run('Abort mid-flight', {
        signal: controller.signal,
      }));

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('aborted');
      expect(steps[0].reason).toContain('Aborted');
    });
  });

  // ── 6. Human-in-the-loop ──

  describe('human-in-the-loop', () => {
    it('should stop when shouldContinue returns false', async () => {
      conversation.send.mockResolvedValue({
        content: 'Working on it...',
        tool_results: [{ name: 'browser_info', result: {} }],
        usage: {},
      });

      const shouldContinue = vi.fn()
        .mockResolvedValueOnce(true)   // allow step 1
        .mockResolvedValueOnce(false); // block after step 2

      const steps = await collectSteps(agent.run('Human controlled', {
        shouldContinue,
        maxSteps: 10,
      }));

      // step 1 (tool_call) + step 2 (tool_call) + interrupted
      expect(steps).toHaveLength(3);
      expect(steps[2].type).toBe('interrupted');
      expect(steps[2].reason).toContain('shouldContinue');
      expect(shouldContinue).toHaveBeenCalledTimes(2);
    });

    it('should stop when shouldContinue throws', async () => {
      conversation.send.mockResolvedValue({
        content: 'Working...',
        tool_results: [{ name: 'browser_info', result: {} }],
        usage: {},
      });

      const shouldContinue = vi.fn().mockRejectedValue(new Error('UI crashed'));

      const steps = await collectSteps(agent.run('Error in gate', {
        shouldContinue,
        maxSteps: 10,
      }));

      // step 1 (tool_call) + interrupted (shouldContinue threw -> treated as false)
      expect(steps).toHaveLength(2);
      expect(steps[1].type).toBe('interrupted');
    });
  });

  // ── 7. Permission blocked ──

  describe('permission blocked', () => {
    it('should stop when preflight denial occurs', async () => {
      // Trip the circuit breaker so preflight fails
      permissions.circuitBreaker.configure({ maxFailures: 1, cooldownMs: 60000 });
      permissions.circuitBreaker.recordFailure();

      const steps = await collectSteps(agent.run('Blocked goal'));

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('blocked');
      expect(steps[0].reason).toContain('Circuit breaker');
      // conversation.send should never be called
      expect(conversation.send).not.toHaveBeenCalled();
    });
  });

  // ── 8. Empty goal error ──

  describe('empty goal error', () => {
    it('should handle empty goal gracefully', async () => {
      // The agent sends the goal as the first message.
      // With an empty string, conversation.send still gets called with ''.
      // The agent itself does not explicitly validate the goal,
      // so we verify the empty string is forwarded to the conversation.
      conversation.send.mockResolvedValueOnce({
        content: 'No goal provided. [DONE]',
        tool_results: [],
        usage: {},
      });

      const steps = await collectSteps(agent.run(''));

      expect(conversation.send).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ namespace: expect.any(String) }),
      );
      expect(steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 9. getStats() ──

  describe('getStats', () => {
    it('should return correct stats after a completed run', async () => {
      conversation.send.mockResolvedValueOnce({
        content: 'Done. [DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Stats test'));

      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(1);
      expect(stats.totalSteps).toBe(1);
      expect(stats.completedRuns).toBe(1);
      expect(stats.abortedRuns).toBe(0);
      expect(stats.errorRuns).toBe(0);
      expect(stats.activeRuns).toBe(0);
      expect(stats.config).toBeDefined();
      expect(stats.config.maxSteps).toBe(10);
    });

    it('should accumulate stats across multiple runs', async () => {
      // Run 1: completes in 2 steps
      conversation.send
        .mockResolvedValueOnce({
          content: 'Working',
          tool_results: [{ name: 'browser_info', result: {} }],
          usage: {},
        })
        .mockResolvedValueOnce({
          content: 'Finished. [DONE]',
          tool_results: [],
          usage: {},
        });

      await collectSteps(agent.run('Run 1'));

      // Run 2: completes in 1 step
      conversation.send.mockResolvedValueOnce({
        content: 'Instant [DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Run 2'));

      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(2);
      expect(stats.totalSteps).toBe(3); // 2 from run 1 + 1 from run 2
      expect(stats.completedRuns).toBe(2);
    });

    it('should count aborted runs in stats', async () => {
      const controller = new AbortController();
      controller.abort();

      await collectSteps(agent.run('Aborted', { signal: controller.signal }));

      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(1);
      expect(stats.abortedRuns).toBe(1);
      expect(stats.completedRuns).toBe(0);
    });
  });

  // ── 10. destroy() ──

  describe('destroy', () => {
    it('should reset stats after destroy', async () => {
      conversation.send.mockResolvedValueOnce({
        content: 'Done. [DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Before destroy'));

      expect(agent.getStats().totalRuns).toBe(1);

      agent.destroy();

      const stats = agent.getStats();
      expect(stats.totalRuns).toBe(0);
      expect(stats.totalSteps).toBe(0);
      expect(stats.completedRuns).toBe(0);
      expect(stats.abortedRuns).toBe(0);
      expect(stats.errorRuns).toBe(0);
    });

    it('should clear active runs on destroy', async () => {
      // We cannot easily test mid-run abort via destroy without concurrency,
      // but we can verify the activeRuns map is cleared.
      agent.destroy();
      expect(agent.getActiveRuns()).toHaveLength(0);
    });
  });

  // ── configure ──

  describe('configure', () => {
    it('should override maxSteps via configure', async () => {
      agent.configure({ maxSteps: 2 });

      conversation.send.mockResolvedValue({
        content: 'Looping...',
        tool_results: [{ name: 'browser_info', result: {} }],
        usage: {},
      });

      const steps = await collectSteps(agent.run('Config test'));

      // 2 tool_call steps + 1 max-steps done
      expect(steps).toHaveLength(3);
      expect(steps[2].reason).toContain('Max steps (2)');
    });

    it('should allow per-run maxSteps to override global config', async () => {
      agent.configure({ maxSteps: 100 });

      conversation.send.mockResolvedValue({
        content: 'Looping...',
        tool_results: [{ name: 'browser_info', result: {} }],
        usage: {},
      });

      const steps = await collectSteps(agent.run('Override test', { maxSteps: 1 }));

      // 1 tool_call step + 1 max-steps done
      expect(steps).toHaveLength(2);
      expect(steps[1].reason).toContain('Max steps (1)');
    });
  });

  // ── onStep callback ──

  describe('onStep callback', () => {
    it('should invoke onStep for each yielded step', async () => {
      conversation.send
        .mockResolvedValueOnce({
          content: 'Step one',
          tool_results: [{ name: 'browser_info', result: {} }],
          usage: {},
        })
        .mockResolvedValueOnce({
          content: 'Final. [DONE]',
          tool_results: [],
          usage: {},
        });

      const onStep = vi.fn();

      await collectSteps(agent.run('Callback test', { onStep }));

      expect(onStep).toHaveBeenCalledTimes(2);
      expect(onStep.mock.calls[0][0].step).toBe(1);
      expect(onStep.mock.calls[1][0].step).toBe(2);
    });
  });

  // ── Event emissions ──

  describe('event emissions', () => {
    it('should emit ai:agent:step for every step', async () => {
      conversation.send
        .mockResolvedValueOnce({
          content: 'Checking...',
          tool_results: [{ name: 'browser_info', result: {} }],
          usage: {},
        })
        .mockResolvedValueOnce({
          content: 'Results ready. [DONE]',
          tool_results: [],
          usage: {},
        });

      await collectSteps(agent.run('Event test'));

      const stepEvents = mockEventBus.emit.mock.calls.filter(c => c[0] === 'ai:agent:step');
      expect(stepEvents).toHaveLength(2);
      expect(stepEvents[0][1].step).toBe(1);
      expect(stepEvents[1][1].step).toBe(2);
    });
  });

  // ── System prompt ──

  describe('system prompt', () => {
    it('should use custom system prompt when provided via options', async () => {
      conversation.send.mockResolvedValueOnce({
        content: '[DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Prompt test', {
        systemPrompt: 'You are a pirate assistant.',
      }));

      expect(conversation.send).toHaveBeenCalledWith(
        'Prompt test',
        expect.objectContaining({
          systemPrompt: 'You are a pirate assistant.',
        }),
      );
    });

    it('should auto-generate system prompt listing tools when no override', async () => {
      conversation.send.mockResolvedValueOnce({
        content: '[DONE]',
        tool_results: [],
        usage: {},
      });

      await collectSteps(agent.run('Auto prompt'));

      const sendCall = conversation.send.mock.calls[0];
      const systemPrompt = sendCall[1].systemPrompt;
      expect(systemPrompt).toContain('autonomous AI agent');
      expect(systemPrompt).toContain('browser_info');
      expect(systemPrompt).toContain('[DONE]');
      expect(systemPrompt).toContain('GOAL: Auto prompt');
    });
  });
});
