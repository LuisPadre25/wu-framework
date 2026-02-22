/**
 * WU-AI-AGENT: Autonomous agent loop (Paradigm 3)
 *
 * The agent is the third paradigm of wu.ai:
 *   Paradigm 1 — App sends messages to LLM (conversation)
 *   Paradigm 2 — External LLM calls into app (tools/WebMCP)
 *   Paradigm 3 — AI as autonomous director (this file)
 *
 * The agent receives a goal and iterates: send to LLM, execute tool calls,
 * observe results, repeat — until the goal is achieved or limits are hit.
 * It is an async generator, yielding each step so the caller can observe,
 * log, render, or intervene at any point.
 *
 * This is a foundation, not a planner. It does not decompose goals into
 * sub-tasks or maintain a world model. It trusts the LLM to drive the
 * loop and uses the [DONE] marker or tool-call cessation as termination
 * signals. More sophisticated planning belongs in userland, composed
 * on top of this primitive.
 *
 * Key features:
 * - Async generator yielding step results (observable, composable)
 * - Human-in-the-loop via shouldContinue callback
 * - Abort support via AbortController
 * - Permission preflight before every step
 * - Event emission on start, step, done, error
 * - Auto-generated system prompt describing agent role and tools
 * - Configurable step limit (default 10)
 */

import { logger } from '../core/wu-logger.js';

// ─── Constants ──────────────────────────────────────────────────

const DONE_MARKER = '[DONE]';

const DEFAULT_MAX_STEPS = 10;

const AGENT_NAMESPACE_PREFIX = 'agent:';

// ─── Step Result Types ──────────────────────────────────────────

/**
 * @typedef {object} AgentStepResult
 * @property {number} step - Step number (1-indexed)
 * @property {'thinking'|'tool_call'|'done'|'blocked'|'aborted'|'interrupted'} type
 * @property {string} [content] - LLM text response for this step
 * @property {Array} [toolResults] - Tool execution results (if tools were called)
 * @property {object} [usage] - Token usage for this step
 * @property {string} [reason] - Reason for termination (done/blocked/aborted)
 * @property {number} elapsed - Time in ms for this step
 */

// ─── Agent Class ────────────────────────────────────────────────

export class WuAIAgent {
  /**
   * @param {object} deps - Injected dependencies (same pattern as other wu-ai modules)
   * @param {import('./wu-ai-conversation.js').WuAIConversation} deps.conversation - Conversation manager
   * @param {import('./wu-ai-actions.js').WuAIActions} deps.actions - Action registry
   * @param {import('./wu-ai-context.js').WuAIContext} deps.context - Context collector
   * @param {import('./wu-ai-permissions.js').WuAIPermissions} deps.permissions - Permission system
   * @param {object} deps.eventBus - WuEventBus instance
   */
  constructor({ conversation, actions, context, permissions, eventBus }) {
    this._conversation = conversation;
    this._actions = actions;
    this._context = context;
    this._permissions = permissions;
    this._eventBus = eventBus;

    this._config = {
      maxSteps: DEFAULT_MAX_STEPS,
      systemPrompt: null,
    };

    this._activeRuns = new Map();  // runId -> AbortController
    this._stats = {
      totalRuns: 0,
      totalSteps: 0,
      completedRuns: 0,
      abortedRuns: 0,
      errorRuns: 0,
    };
  }

  /**
   * Post-init configuration.
   *
   * @param {object} config
   * @param {number} [config.maxSteps] - Default max steps for all runs
   * @param {string|Function} [config.systemPrompt] - Default agent system prompt
   */
  configure(config) {
    if (config.maxSteps !== undefined) this._config.maxSteps = config.maxSteps;
    if (config.systemPrompt !== undefined) this._config.systemPrompt = config.systemPrompt;
  }

  /**
   * Run the agent loop toward a goal.
   *
   * The generator yields after each LLM round. The caller can inspect
   * the result, update UI, or break out of the loop to abort early.
   *
   * Termination conditions (checked in order):
   *   1. AbortController signal fired
   *   2. shouldContinue() returns false (human-in-the-loop gate)
   *   3. Permission preflight denied
   *   4. LLM response contains [DONE] marker
   *   5. LLM stops requesting tool calls (after previously requesting them)
   *   6. maxSteps reached
   *
   * @param {string} goal - Natural language description of what to achieve
   * @param {object} [options]
   * @param {number} [options.maxSteps] - Override max steps for this run
   * @param {string} [options.provider] - Use a specific registered provider
   * @param {string} [options.namespace] - Conversation namespace (auto-generated if omitted)
   * @param {string|Function} [options.systemPrompt] - Override system prompt
   * @param {Function} [options.onStep] - Callback invoked after each step: (stepResult) => void
   * @param {Function} [options.shouldContinue] - Async gate: (stepResult) => boolean. Return false to stop.
   * @param {AbortSignal} [options.signal] - External abort signal
   * @param {number} [options.temperature] - LLM temperature
   * @param {number} [options.maxTokens] - LLM max tokens per step
   * @yields {AgentStepResult}
   */
  async *run(goal, options = {}) {
    const maxSteps = options.maxSteps ?? this._config.maxSteps;
    const namespace = options.namespace || this._generateNamespace();
    const runId = this._generateRunId();

    // Abort controller: merge external signal with our own
    const controller = new AbortController();
    this._activeRuns.set(runId, controller);

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    this._stats.totalRuns++;

    // Build the agent system prompt
    const systemPrompt = await this._buildAgentSystemPrompt(goal, options);

    // Emit start event
    this._eventBus.emit('ai:agent:start', {
      runId,
      goal,
      namespace,
      maxSteps,
    }, { appName: 'wu-ai' });

    logger.wuInfo(`[wu-ai] Agent run started: "${goal.slice(0, 80)}${goal.length > 80 ? '...' : ''}" (max ${maxSteps} steps)`);

    let step = 0;
    let previousHadToolCalls = false;
    let finalReason = 'max_steps';

    try {
      // Inject the goal as the first user message via conversation.send
      // The loop sends the goal on step 1, then follow-up prompts on subsequent steps.

      while (step < maxSteps) {
        step++;
        const stepStart = Date.now();

        // ── 1. Check abort ──
        if (controller.signal.aborted) {
          const result = this._buildStepResult(step, 'aborted', {
            reason: 'Aborted by caller',
            elapsed: Date.now() - stepStart,
          });
          this._stats.abortedRuns++;
          finalReason = 'aborted';
          this._emitStep(runId, result);
          yield result;
          return;
        }

        // ── 2. Permission preflight ──
        const traceId = this._permissions.loopProtection.createTraceId();
        const preflight = this._permissions.preflight({
          namespace,
          depth: step,
          traceId,
        });

        if (!preflight.allowed) {
          const result = this._buildStepResult(step, 'blocked', {
            reason: preflight.reason,
            elapsed: Date.now() - stepStart,
          });
          finalReason = 'blocked';
          this._emitStep(runId, result);
          yield result;
          return;
        }

        // ── 3. Compose the message for this step ──
        const message = step === 1
          ? goal
          : 'Continue working toward the goal. If you are done, include [DONE] in your response.';

        // ── 4. Send to conversation (handles tool call loops internally) ──
        let response;
        try {
          response = await this._conversation.send(message, {
            namespace,
            systemPrompt,
            provider: options.provider,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            signal: controller.signal,
          });
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) {
            const result = this._buildStepResult(step, 'aborted', {
              reason: 'Aborted during LLM call',
              elapsed: Date.now() - stepStart,
            });
            this._stats.abortedRuns++;
            finalReason = 'aborted';
            this._emitStep(runId, result);
            yield result;
            return;
          }
          throw err;
        }

        const elapsed = Date.now() - stepStart;
        this._stats.totalSteps++;

        const hasToolResults = response.tool_results && response.tool_results.length > 0;
        const content = response.content || '';

        // ── 5. Check for DONE marker ──
        if (content.includes(DONE_MARKER)) {
          const result = this._buildStepResult(step, 'done', {
            content: content.replace(DONE_MARKER, '').trim(),
            toolResults: response.tool_results,
            usage: response.usage,
            reason: 'Goal completed (DONE marker)',
            elapsed,
          });
          finalReason = 'done';
          this._stats.completedRuns++;
          this._emitStep(runId, result);
          if (options.onStep) await this._safeCallback(options.onStep, result);
          yield result;
          return;
        }

        // ── 6. Check for tool-call cessation ──
        // If the LLM was previously calling tools but stopped, it has
        // settled on a final answer. This is the implicit completion signal.
        const currentHasToolCalls = hasToolResults;
        if (previousHadToolCalls && !currentHasToolCalls) {
          const result = this._buildStepResult(step, 'done', {
            content,
            toolResults: response.tool_results,
            usage: response.usage,
            reason: 'Goal completed (no further tool calls)',
            elapsed,
          });
          finalReason = 'done';
          this._stats.completedRuns++;
          this._emitStep(runId, result);
          if (options.onStep) await this._safeCallback(options.onStep, result);
          yield result;
          return;
        }

        previousHadToolCalls = currentHasToolCalls;

        // ── 7. Yield the step result ──
        const stepType = hasToolResults ? 'tool_call' : 'thinking';
        const result = this._buildStepResult(step, stepType, {
          content,
          toolResults: response.tool_results,
          usage: response.usage,
          elapsed,
        });

        this._emitStep(runId, result);
        if (options.onStep) await this._safeCallback(options.onStep, result);
        yield result;

        // ── 8. Human-in-the-loop gate ──
        if (options.shouldContinue) {
          let shouldGo;
          try {
            shouldGo = await options.shouldContinue(result);
          } catch {
            shouldGo = false;
          }

          if (!shouldGo) {
            const interrupted = this._buildStepResult(step, 'interrupted', {
              content,
              reason: 'Stopped by shouldContinue callback',
              elapsed: 0,
            });
            finalReason = 'interrupted';
            this._emitStep(runId, interrupted);
            yield interrupted;
            return;
          }
        }
      }

      // ── Max steps reached ──
      const maxStepResult = this._buildStepResult(step, 'done', {
        reason: `Max steps (${maxSteps}) reached`,
        elapsed: 0,
      });
      finalReason = 'max_steps';
      yield maxStepResult;

    } catch (err) {
      this._stats.errorRuns++;
      finalReason = 'error';

      logger.wuWarn(`[wu-ai] Agent run error: ${err.message}`);

      this._eventBus.emit('ai:agent:error', {
        runId,
        goal,
        namespace,
        step,
        error: err.message,
      }, { appName: 'wu-ai' });

      throw err;
    } finally {
      // Clean up
      this._activeRuns.delete(runId);

      // Delete auto-generated agent namespaces to prevent memory leaks
      // User-provided namespaces are preserved (the user owns their lifecycle)
      if (!options.namespace && namespace.startsWith(AGENT_NAMESPACE_PREFIX)) {
        this._conversation.deleteNamespace(namespace);
      }

      this._eventBus.emit('ai:agent:done', {
        runId,
        goal,
        namespace,
        totalSteps: step,
        reason: finalReason,
      }, { appName: 'wu-ai' });

      logger.wuDebug(`[wu-ai] Agent run finished: ${finalReason} after ${step} step(s)`);
    }
  }

  /**
   * Abort an active agent run by runId.
   *
   * @param {string} runId - The run ID to abort
   */
  abort(runId) {
    const controller = this._activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.wuDebug(`[wu-ai] Agent run aborted: ${runId}`);
    }
  }

  /**
   * Abort all active agent runs.
   */
  abortAll() {
    for (const [runId, controller] of this._activeRuns) {
      controller.abort();
    }
    this._activeRuns.clear();
  }

  /**
   * Get IDs of currently active runs.
   *
   * @returns {string[]}
   */
  getActiveRuns() {
    return [...this._activeRuns.keys()];
  }

  /**
   * Get agent statistics.
   *
   * @returns {object}
   */
  getStats() {
    return {
      ...this._stats,
      activeRuns: this._activeRuns.size,
      config: { ...this._config },
    };
  }

  /**
   * Destroy the agent, aborting all active runs.
   */
  destroy() {
    this.abortAll();
    this._stats = {
      totalRuns: 0,
      totalSteps: 0,
      completedRuns: 0,
      abortedRuns: 0,
      errorRuns: 0,
    };
  }

  // ─── Private ──────────────────────────────────────────────────

  /**
   * Build the agent-specific system prompt. This tells the LLM it is
   * operating as an autonomous agent with a goal, available tools, and
   * the [DONE] completion protocol.
   */
  async _buildAgentSystemPrompt(goal, options) {
    // Explicit override takes precedence
    const basePrompt = options.systemPrompt
      ?? this._config.systemPrompt
      ?? null;

    if (basePrompt) {
      const resolved = typeof basePrompt === 'function'
        ? await basePrompt(goal)
        : basePrompt;
      return resolved;
    }

    // Auto-generate from context and tools
    const parts = [];

    parts.push(
      'You are an autonomous AI agent connected to a live web application via Wu Framework.',
      'You have been given a goal and must work step-by-step to achieve it.',
      '',
      'PROTOCOL:',
      '- Each message you send is one "step" in your execution.',
      '- You may call tools to read or modify application state.',
      '- After each step, you will be prompted to continue.',
      '- When the goal is fully achieved, include the marker [DONE] in your response.',
      '- If you determine the goal cannot be achieved, include [DONE] and explain why.',
      '- Be concise. Each step should make meaningful progress.',
      '',
    );

    // Collect context if available
    if (this._context) {
      try {
        await this._context.collect();
        const snapshot = this._context.getSnapshot();
        if (snapshot?._mountedApps?.length) {
          parts.push(`MOUNTED APPS: ${snapshot._mountedApps.join(', ')}`, '');
        }
        if (snapshot?._store && Object.keys(snapshot._store).length > 0) {
          parts.push(`APPLICATION STATE:\n${JSON.stringify(snapshot._store, null, 2)}`, '');
        }
      } catch {
        // Context collection is best-effort
      }
    }

    // List available tools
    const tools = this._actions.getToolSchemas();
    if (tools.length > 0) {
      parts.push('AVAILABLE TOOLS:');
      for (const tool of tools) {
        const paramKeys = tool.parameters?.properties
          ? Object.keys(tool.parameters.properties).join(', ')
          : 'none';
        parts.push(`- ${tool.name}(${paramKeys}): ${tool.description}`);
      }
      parts.push('');
    }

    parts.push(`GOAL: ${goal}`);

    return parts.join('\n');
  }

  /**
   * Build a normalized step result object.
   *
   * @param {number} step
   * @param {string} type
   * @param {object} data
   * @returns {AgentStepResult}
   */
  _buildStepResult(step, type, data = {}) {
    return {
      step,
      type,
      content: data.content ?? null,
      toolResults: data.toolResults ?? null,
      usage: data.usage ?? null,
      reason: data.reason ?? null,
      elapsed: data.elapsed ?? 0,
    };
  }

  /**
   * Emit an ai:agent:step event.
   */
  _emitStep(runId, result) {
    this._eventBus.emit('ai:agent:step', {
      runId,
      ...result,
    }, { appName: 'wu-ai' });
  }

  /**
   * Safely invoke a callback, swallowing errors so the agent loop
   * is never broken by a faulty onStep handler.
   */
  async _safeCallback(fn, ...args) {
    try {
      const result = fn(...args);
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (err) {
      logger.wuDebug(`[wu-ai] Agent callback error: ${err.message}`);
    }
  }

  /**
   * Generate a unique namespace for an agent run.
   */
  _generateNamespace() {
    return AGENT_NAMESPACE_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Generate a unique run ID.
   */
  _generateRunId() {
    return 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
}
