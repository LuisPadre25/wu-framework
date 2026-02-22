/**
 * WU-AI-CONVERSATION: Multi-turn conversation manager
 *
 * Manages conversation state per namespace. Each namespace maintains
 * its own message history, enabling multiple independent AI conversations
 * (e.g., chat widget, background triggers, admin panel).
 *
 * Key features:
 * - Multi-turn per namespace (isolated histories)
 * - Streaming with async generator passthrough
 * - Tool call loop (max rounds configurable, default 5)
 * - Abort support via AbortController
 * - Automatic context injection before each send
 * - Token-aware history truncation
 */

import { logger } from '../core/wu-logger.js';
import { sanitizeForPrompt, interpolate } from './wu-ai-schema.js';

// ─── Default Config ──────────────────────────────────────────────

const DEFAULT_CONFIG = {
  maxHistoryMessages: 50,    // per namespace
  maxToolRounds: 5,          // tool call loop limit
  defaultNamespace: 'default',
  systemPrompt: null,        // string or function returning string
  temperature: undefined,
  maxTokens: undefined,
  namespaceTTL: 30 * 60_000, // 30 min — auto-expire inactive namespaces (0 = disabled)
  gcInterval: 5 * 60_000,    // 5 min — how often to sweep for expired namespaces
};

// ─── Conversation Namespace ──────────────────────────────────────

class ConversationNamespace {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this._abortController = null;
  }

  addMessage(msg) {
    this.messages.push({ ...msg, _ts: Date.now() });
    this.lastActivity = Date.now();
  }

  getMessages() {
    return this.messages.map(({ _ts, ...rest }) => rest);
  }

  truncate(maxMessages) {
    if (this.messages.length <= maxMessages) return;

    // Keep system messages + last N messages
    const system = this.messages.filter(m => m.role === 'system');
    const nonSystem = this.messages.filter(m => m.role !== 'system');
    const kept = nonSystem.slice(-maxMessages);
    this.messages = [...system, ...kept];
  }

  clear() {
    this.messages = [];
    this.lastActivity = Date.now();
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  createAbortController() {
    this.abort(); // cancel previous if any
    this._abortController = new AbortController();
    return this._abortController;
  }
}

// ─── Main Conversation Manager ───────────────────────────────────

export class WuAIConversation {
  constructor({ provider, actions, context, permissions, eventBus }) {
    this._provider = provider;
    this._actions = actions;
    this._context = context;
    this._permissions = permissions;
    this._eventBus = eventBus;

    this._config = { ...DEFAULT_CONFIG };
    this._namespaces = new Map();
    this._activeRequests = new Map(); // namespace → promise
    this._lastGcRun = Date.now();
  }

  /**
   * Configure conversation defaults.
   */
  configure(config) {
    Object.assign(this._config, config);
  }

  /**
   * Send a message and get a complete response.
   * Handles multi-turn tool call loops automatically.
   *
   * @param {string} message - User message
   * @param {object} [options]
   * @param {string} [options.namespace='default'] - Conversation namespace
   * @param {string} [options.systemPrompt] - Override system prompt
   * @param {object} [options.templateVars] - Variables for template interpolation
   * @param {number} [options.temperature] - Override temperature
   * @param {number} [options.maxTokens] - Override max tokens
   * @param {string|object} [options.responseFormat] - Request JSON output ('json' or { type: 'json_schema', schema, name? })
   * @param {AbortSignal} [options.signal] - External abort signal
   * @returns {Promise<{ content: string, tool_results?: Array, usage?: object, namespace: string }>}
   */
  async send(message, options = {}) {
    const ns = this._getOrCreateNamespace(options.namespace);
    const traceId = this._permissions.loopProtection.createTraceId();
    const meta = { namespace: ns.name, depth: 0, traceId };

    // Preflight checks
    const preflight = this._permissions.preflight(meta);
    if (!preflight.allowed) {
      return { content: `[blocked] ${preflight.reason}`, namespace: ns.name };
    }

    // Build system prompt
    const systemPrompt = await this._buildSystemPrompt(options);

    // Ensure system message is set/updated
    this._setSystemMessage(ns, systemPrompt);

    // Add user message
    const processedMessage = this._processMessage(message, options.templateVars);
    ns.addMessage({ role: 'user', content: processedMessage });

    // Truncate history if needed
    ns.truncate(this._config.maxHistoryMessages);

    // Create abort controller (merges with external signal)
    const controller = ns.createAbortController();
    const signal = this._mergeSignals(controller.signal, options.signal);

    // Rate limit tracking
    this._permissions.rateLimiter.recordStart(ns.name);

    try {
      // Tool call loop
      const toolResults = [];
      let rounds = 0;
      const maxRounds = this._config.maxToolRounds;

      while (rounds <= maxRounds) {
        // Get tools if actions are registered
        const tools = this._actions.getToolSchemas();

        const response = await this._provider.send(ns.getMessages(), {
          tools: tools.length > 0 ? tools : undefined,
          temperature: options.temperature ?? this._config.temperature,
          maxTokens: options.maxTokens ?? this._config.maxTokens,
          responseFormat: options.responseFormat,
          provider: options.provider,
          signal,
        });

        // Add assistant response to history
        const assistantMsg = { role: 'assistant', content: response.content || '' };
        if (response.tool_calls) assistantMsg.tool_calls = response.tool_calls;
        ns.addMessage(assistantMsg);

        // No tool calls → we're done
        if (!response.tool_calls || response.tool_calls.length === 0) {
          this._permissions.circuitBreaker.recordSuccess();

          this._eventBus.emit('ai:response', {
            namespace: ns.name,
            content: response.content,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
            usage: response.usage,
            traceId,
          }, { appName: 'wu-ai' });

          return {
            content: response.content || '',
            tool_results: toolResults.length > 0 ? toolResults : undefined,
            usage: response.usage,
            namespace: ns.name,
          };
        }

        // Execute tool calls
        rounds++;
        if (rounds > maxRounds) {
          const msg = `[wu-ai] Tool call loop limit (${maxRounds}) reached in namespace '${ns.name}'`;
          logger.wuWarn(msg);
          ns.addMessage({ role: 'assistant', content: msg });
          return { content: msg, tool_results: toolResults, namespace: ns.name };
        }

        // Loop protection
        this._permissions.loopProtection.enter(traceId);

        for (const toolCall of response.tool_calls) {
          const result = await this._actions.execute(toolCall.name, toolCall.arguments, {
            traceId,
            depth: rounds,
            callId: toolCall.id,
          });

          toolResults.push({
            tool: toolCall.name,
            params: toolCall.arguments,
            result: result.result,
            success: result.success,
          });

          // Add tool result to conversation
          ns.addMessage({
            role: 'tool',
            content: JSON.stringify(result.success ? result.result : { error: result.reason }),
            tool_call_id: toolCall.id,
          });
        }

        this._permissions.loopProtection.exit(traceId);
      }

      // Should not reach here, but safety net
      return { content: '', tool_results: toolResults, namespace: ns.name };

    } catch (err) {
      this._permissions.circuitBreaker.recordFailure();

      if (err.name === 'AbortError') {
        return { content: '[aborted]', namespace: ns.name };
      }

      this._eventBus.emit('ai:error', {
        namespace: ns.name,
        error: err.message,
        traceId,
      }, { appName: 'wu-ai' });

      throw err;
    } finally {
      this._permissions.rateLimiter.recordEnd();
      ns._abortController = null;
    }
  }

  /**
   * Send a message with streaming response.
   * Returns an async generator that yields chunks.
   *
   * @param {string} message - User message
   * @param {object} [options] - Same as send()
   * @yields {{ type: 'text'|'tool_call'|'done'|'error', content?: string, tool_call?: object }}
   */
  async *stream(message, options = {}) {
    const ns = this._getOrCreateNamespace(options.namespace);
    const traceId = this._permissions.loopProtection.createTraceId();
    const meta = { namespace: ns.name, depth: 0, traceId };

    // Preflight checks
    const preflight = this._permissions.preflight(meta);
    if (!preflight.allowed) {
      yield { type: 'error', error: preflight.reason };
      return;
    }

    // Build system prompt and set it
    const systemPrompt = await this._buildSystemPrompt(options);
    this._setSystemMessage(ns, systemPrompt);

    // Add user message
    const processedMessage = this._processMessage(message, options.templateVars);
    ns.addMessage({ role: 'user', content: processedMessage });
    ns.truncate(this._config.maxHistoryMessages);

    // Abort controller
    const controller = ns.createAbortController();
    const signal = this._mergeSignals(controller.signal, options.signal);

    this._permissions.rateLimiter.recordStart(ns.name);

    try {
      // Tool call loop — mirrors send() behavior (up to maxToolRounds)
      let rounds = 0;
      const maxRounds = this._config.maxToolRounds;

      while (rounds <= maxRounds) {
        const tools = this._actions.getToolSchemas();
        let fullContent = '';
        const toolCallAccumulator = new Map(); // index → { id, name, args }
        let streamEnded = false;

        for await (const chunk of this._provider.stream(ns.getMessages(), {
          tools: tools.length > 0 ? tools : undefined,
          temperature: options.temperature ?? this._config.temperature,
          maxTokens: options.maxTokens ?? this._config.maxTokens,
          responseFormat: options.responseFormat,
          provider: options.provider,
          signal,
        })) {
          if (chunk.type === 'text') {
            fullContent += chunk.content;
            yield chunk;
          } else if (chunk.type === 'tool_call_start') {
            toolCallAccumulator.set(toolCallAccumulator.size, {
              id: chunk.id,
              name: chunk.name,
              args: '',
            });
          } else if (chunk.type === 'tool_call_delta') {
            const idx = chunk.index ?? (toolCallAccumulator.size - 1);
            const acc = toolCallAccumulator.get(idx);
            if (acc) {
              if (chunk.id) acc.id = chunk.id;
              if (chunk.name) acc.name = chunk.name;
              acc.args += chunk.argumentsDelta || '';
            } else {
              toolCallAccumulator.set(idx, {
                id: chunk.id || `tc_${idx}`,
                name: chunk.name || '',
                args: chunk.argumentsDelta || '',
              });
            }
          } else if (chunk.type === 'done') {
            streamEnded = true;
            break; // exit inner loop, handle tool calls below
          } else if (chunk.type === 'usage') {
            yield chunk;
          } else if (chunk.type === 'error') {
            yield chunk;
          }
        }

        // No tool calls → final response, we're done
        if (toolCallAccumulator.size === 0) {
          if (fullContent) {
            ns.addMessage({ role: 'assistant', content: fullContent });
          }
          this._permissions.circuitBreaker.recordSuccess();
          yield { type: 'done' };
          return;
        }

        // Tool calls detected — execute them
        rounds++;
        if (rounds > maxRounds) {
          const msg = `[wu-ai] Tool call loop limit (${maxRounds}) reached in streaming namespace '${ns.name}'`;
          logger.wuWarn(msg);
          yield { type: 'error', error: msg };
          yield { type: 'done' };
          return;
        }

        // Parse accumulated tool calls
        const toolCalls = [];
        for (const [, acc] of toolCallAccumulator) {
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(acc.args); } catch { /* empty args */ }
          toolCalls.push({ id: acc.id, name: acc.name, arguments: parsedArgs });
        }

        // Add assistant message with tool calls to history
        ns.addMessage({ role: 'assistant', content: fullContent, tool_calls: toolCalls });

        // Execute each tool call
        this._permissions.loopProtection.enter(traceId);
        for (const tc of toolCalls) {
          const result = await this._actions.execute(tc.name, tc.arguments, {
            traceId, depth: rounds, callId: tc.id,
          });

          yield {
            type: 'tool_result',
            tool: tc.name,
            result: result.success ? result.result : { error: result.reason },
            success: result.success,
          };

          ns.addMessage({
            role: 'tool',
            content: JSON.stringify(result.success ? result.result : { error: result.reason }),
            tool_call_id: tc.id,
          });
        }
        this._permissions.loopProtection.exit(traceId);

        yield { type: 'tool_calls_done', count: toolCalls.length };
        // Loop continues → re-stream with tool results in history
      }

    } catch (err) {
      this._permissions.circuitBreaker.recordFailure();

      if (err.name === 'AbortError') {
        yield { type: 'error', error: 'aborted' };
        return;
      }

      yield { type: 'error', error: err.message };

      this._eventBus.emit('ai:error', {
        namespace: ns.name,
        error: err.message,
        traceId,
      }, { appName: 'wu-ai' });
    } finally {
      this._permissions.rateLimiter.recordEnd();
      ns._abortController = null;
    }
  }

  /**
   * Add a message to a namespace without sending to LLM.
   * Useful for injecting context or tool results manually.
   */
  inject(role, content, options = {}) {
    const ns = this._getOrCreateNamespace(options.namespace);
    ns.addMessage({ role, content });
  }

  /**
   * Get conversation history for a namespace.
   */
  getHistory(namespace) {
    const ns = this._namespaces.get(namespace || this._config.defaultNamespace);
    return ns ? ns.getMessages() : [];
  }

  /**
   * Clear conversation history for a namespace.
   */
  clear(namespace) {
    const ns = this._namespaces.get(namespace || this._config.defaultNamespace);
    if (ns) ns.clear();
  }

  /**
   * Clear all namespaces.
   */
  clearAll() {
    for (const ns of this._namespaces.values()) {
      ns.clear();
    }
  }

  /**
   * Abort an active request in a namespace.
   */
  abort(namespace) {
    const ns = this._namespaces.get(namespace || this._config.defaultNamespace);
    if (ns) ns.abort();
  }

  /**
   * Abort all active requests.
   */
  abortAll() {
    for (const ns of this._namespaces.values()) {
      ns.abort();
    }
  }

  /**
   * List active namespaces.
   */
  getNamespaces() {
    return [...this._namespaces.keys()];
  }

  /**
   * Delete a namespace entirely.
   */
  deleteNamespace(namespace) {
    const ns = this._namespaces.get(namespace);
    if (ns) {
      ns.abort();
      this._namespaces.delete(namespace);
    }
  }

  // ── Private ──

  _getOrCreateNamespace(name) {
    const nsName = name || this._config.defaultNamespace;

    // Lazy GC sweep — only runs periodically, not on every access
    this._maybeGcSweep();

    if (!this._namespaces.has(nsName)) {
      this._namespaces.set(nsName, new ConversationNamespace(nsName));
    }
    const ns = this._namespaces.get(nsName);
    ns.lastActivity = Date.now();
    return ns;
  }

  /**
   * Sweep expired namespaces. Called lazily on access, throttled by gcInterval.
   * Never deletes the default namespace or namespaces with active requests.
   */
  _maybeGcSweep() {
    const ttl = this._config.namespaceTTL;
    const interval = this._config.gcInterval;
    if (!ttl || ttl <= 0) return; // GC disabled

    const now = Date.now();
    if (now - this._lastGcRun < interval) return; // Not time yet
    this._lastGcRun = now;

    const cutoff = now - ttl;
    const toDelete = [];

    for (const [name, ns] of this._namespaces) {
      // Never GC the default namespace
      if (name === this._config.defaultNamespace) continue;
      // Don't GC namespaces with active abort controllers (in-flight request)
      if (ns._abortController) continue;
      // Expired?
      if (ns.lastActivity < cutoff) {
        toDelete.push(name);
      }
    }

    for (const name of toDelete) {
      this._namespaces.delete(name);
    }

    if (toDelete.length > 0) {
      logger.wuDebug(`[wu-ai] GC sweep: removed ${toDelete.length} expired namespace(s): ${toDelete.join(', ')}`);
    }
  }

  async _buildSystemPrompt(options) {
    // 1. Explicit override
    if (options.systemPrompt) {
      return typeof options.systemPrompt === 'function'
        ? await options.systemPrompt()
        : options.systemPrompt;
    }

    // 2. Config-level system prompt
    if (this._config.systemPrompt) {
      return typeof this._config.systemPrompt === 'function'
        ? await this._config.systemPrompt()
        : this._config.systemPrompt;
    }

    // 3. Auto-generate from context
    if (this._context) {
      await this._context.collect();
      const tools = this._actions.getToolSchemas();
      return this._context.toSystemPrompt({ tools });
    }

    return 'You are an AI assistant connected to a web application via Wu Framework.';
  }

  _setSystemMessage(ns, systemPrompt) {
    // Replace or insert system message at the beginning
    if (ns.messages.length > 0 && ns.messages[0].role === 'system') {
      ns.messages[0].content = systemPrompt;
      ns.messages[0]._ts = Date.now();
    } else {
      ns.messages.unshift({ role: 'system', content: systemPrompt, _ts: Date.now() });
    }
  }

  _processMessage(message, templateVars) {
    if (!templateVars) return message;
    try {
      const contextVars = this._context?.getInterpolationContext() || {};
      return interpolate(message, { ...contextVars, ...templateVars });
    } catch {
      return message;
    }
  }

  _mergeSignals(internalSignal, externalSignal) {
    if (!externalSignal) return internalSignal;

    // If AbortSignal.any is available (modern browsers), use it
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
      return AbortSignal.any([internalSignal, externalSignal]);
    }

    // Fallback: create a new controller that listens to both
    const merged = new AbortController();
    const onAbort = () => merged.abort();
    internalSignal.addEventListener('abort', onAbort, { once: true });
    externalSignal.addEventListener('abort', onAbort, { once: true });
    return merged.signal;
  }

  getStats() {
    const namespaces = {};
    for (const [name, ns] of this._namespaces) {
      namespaces[name] = {
        messageCount: ns.messages.length,
        lastActivity: ns.lastActivity,
        hasActiveRequest: !!ns._abortController,
      };
    }
    return { namespaces, config: { ...this._config } };
  }
}
