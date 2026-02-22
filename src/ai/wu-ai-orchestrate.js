/**
 * WU-AI-ORCHESTRATE: Cross-Micro-App AI Coordination (Paradigm 4)
 *
 * The fourth paradigm of wu.ai:
 *   Paradigm 1 — App sends messages to LLM (conversation)
 *   Paradigm 2 — External LLM calls into app (tools/WebMCP)
 *   Paradigm 3 — AI as autonomous director (agent loop)
 *   Paradigm 4 — AI as microfrontend glue (this file)
 *
 * The Problem:
 *   In microfrontend architectures, apps are isolated by design.
 *   Cross-app coordination requires manual wiring through events
 *   and shared state. As apps grow, wiring becomes n² complexity.
 *
 * The Solution:
 *   Each micro-app declares its capabilities to the AI layer.
 *   The AI understands the semantic meaning of each capability
 *   and can resolve natural-language intents by calling the right
 *   actions across the right apps — without tight coupling.
 *
 * Key Concepts:
 *   - Capability: An action scoped to a specific micro-app
 *     Registered as 'appName:actionName', cleaned up on unmount.
 *   - Intent: A natural-language cross-app request resolved in
 *     a single conversation turn with an orchestrator system prompt.
 *   - Capability Map: The AI's understanding of system topology —
 *     which apps exist and what each can do.
 *
 * This module does NOT replace actions, triggers, or agents.
 * It enriches them with cross-app topology awareness.
 *
 * API (accessible via wu.ai):
 *   wu.ai.capability(app, name, config)   → Register app-scoped capability
 *   wu.ai.intent(description, options)    → Resolve cross-app intent
 *   wu.ai.removeApp(appName)              → Cleanup on unmount
 *   wu.ai.workflow(name, config)          → Register reusable AI workflow
 *   wu.ai.runWorkflow(name, params, opts) → Execute a registered workflow
 */

import { logger } from '../core/wu-logger.js';
import { clickElement, typeIntoElement } from './wu-ai-browser-primitives.js';

// ─── Constants ──────────────────────────────────────────────────

const INTENT_NAMESPACE_PREFIX = 'intent:';

// ─── Deterministic Step Actions ─────────────────────────────────

/**
 * Execute a single deterministic workflow step.
 * No AI needed — directly calls browser primitives.
 *
 * @param {object} step - Step definition
 * @param {string} step.action - 'click' | 'type' | 'navigate' | 'wait' | 'emit' | 'setState'
 * @param {object} params - Interpolated params
 * @returns {{ success: boolean, detail?: string, error?: string }}
 */
function executeDeterministicStep(step, eventBus, store) {
  switch (step.action) {
    case 'click': {
      const result = clickElement(step.selector, step.text);
      if (result.error) return { success: false, error: result.error };
      return { success: true, detail: `Clicked: ${step.selector || step.text}` };
    }

    case 'type': {
      const result = typeIntoElement(step.selector, step.value, {
        clear: step.clear ?? true,
        submit: step.submit ?? false,
      });
      if (result.error) return { success: false, error: result.error };
      return { success: true, detail: `Typed "${step.value}" into ${step.selector}` };
    }

    case 'navigate': {
      if (eventBus && step.section) {
        eventBus.emit('nav:section', { section: step.section }, { appName: 'wu-ai' });
        return { success: true, detail: `Navigated to section: ${step.section}` };
      }
      if (step.selector) {
        const result = clickElement(step.selector, step.text);
        if (result.error) return { success: false, error: result.error };
        return { success: true, detail: `Navigated via click: ${step.selector}` };
      }
      return { success: false, error: 'navigate requires "section" or "selector"' };
    }

    case 'wait': {
      // Wait is handled by the runner (delay + optional selector poll)
      return { success: true, detail: `Wait: ${step.ms || 0}ms` };
    }

    case 'emit': {
      if (!eventBus) return { success: false, error: 'eventBus not available' };
      eventBus.emit(step.event, step.data || {}, { appName: 'wu-ai' });
      return { success: true, detail: `Emitted: ${step.event}` };
    }

    case 'setState': {
      if (!store) return { success: false, error: 'store not available' };
      store.set(step.path, step.value);
      return { success: true, detail: `Set state: ${step.path}` };
    }

    default:
      return { success: false, error: `Unknown action: ${step.action}` };
  }
}

/**
 * Wait for a selector to appear in the DOM (with timeout).
 *
 * @param {string} selector
 * @param {number} timeout - ms
 * @returns {Promise<boolean>}
 */
function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }

    const interval = 100;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += interval;
      if (document.querySelector(selector)) {
        clearInterval(timer);
        resolve(true);
      } else if (elapsed >= timeout) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });
}

/**
 * Simple delay.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── WuAIOrchestrate ────────────────────────────────────────────

export class WuAIOrchestrate {
  /**
   * @param {object} deps
   * @param {import('./wu-ai-actions.js').WuAIActions} deps.actions
   * @param {import('./wu-ai-conversation.js').WuAIConversation} deps.conversation
   * @param {import('./wu-ai-context.js').WuAIContext} deps.context
   * @param {import('./wu-ai-permissions.js').WuAIPermissions} deps.permissions
   * @param {object} deps.eventBus
   */
  constructor({ actions, conversation, context, permissions, eventBus, agent, store }) {
    this._actions = actions;
    this._conversation = conversation;
    this._context = context;
    this._permissions = permissions;
    this._eventBus = eventBus;
    this._agent = agent; // WuAIAgent — for workflow execution
    this._store = store; // WuStore — for deterministic setState steps

    // appName → Map<actionName, { description, qualifiedName }>
    this._capabilities = new Map();

    // name → { goal, steps, parameters, provider, ... }
    this._workflows = new Map();

    this._config = {
      defaultProvider: null,
      defaultTemperature: 0.3, // lower temp for orchestration
    };

    this._stats = {
      totalIntents: 0,
      resolvedIntents: 0,
      failedIntents: 0,
      workflowsRegistered: 0,
      workflowsExecuted: 0,
    };
  }

  /**
   * Post-init configuration.
   *
   * @param {object} config
   * @param {string} [config.defaultProvider] - Default provider for intents
   * @param {number} [config.defaultTemperature] - Default temperature for intents
   */
  configure(config) {
    if (config.defaultProvider !== undefined) this._config.defaultProvider = config.defaultProvider;
    if (config.defaultTemperature !== undefined) this._config.defaultTemperature = config.defaultTemperature;
  }

  // ─── Capability Registration ────────────────────────────────────

  /**
   * Register a capability scoped to a micro-app.
   *
   * Under the hood this registers a normal action with the qualified
   * name 'appName:actionName' so the LLM can call it directly.
   * The capability map is tracked separately for lifecycle management
   * (removeApp) and system prompt enrichment.
   *
   * @param {string} appName - The micro-app name (e.g., 'orders', 'dashboard')
   * @param {string} actionName - The capability name (e.g., 'getRecent', 'updateKPIs')
   * @param {object} config - Same as wu.ai.action() config:
   *   { description, parameters, handler, confirm?, permissions?, dangerous? }
   */
  register(appName, actionName, config) {
    if (!appName || !actionName) {
      throw new Error('[wu-ai] capability() requires both appName and actionName');
    }
    if (!config || typeof config.handler !== 'function') {
      throw new Error(`[wu-ai] capability '${appName}:${actionName}' must have a handler function`);
    }

    const qualifiedName = `${appName}:${actionName}`;

    // Track in capability map
    if (!this._capabilities.has(appName)) {
      this._capabilities.set(appName, new Map());
    }
    this._capabilities.get(appName).set(actionName, {
      description: config.description || actionName,
      qualifiedName,
    });

    // Register as a normal action with enriched description
    this._actions.register(qualifiedName, {
      ...config,
      description: `[${appName}] ${config.description || actionName}`,
    });

    logger.wuDebug(`[wu-ai] Capability registered: ${qualifiedName}`);
  }

  /**
   * Remove a single capability.
   *
   * @param {string} appName
   * @param {string} actionName
   */
  unregister(appName, actionName) {
    const appCaps = this._capabilities.get(appName);
    if (!appCaps) return;

    const qualifiedName = `${appName}:${actionName}`;
    appCaps.delete(actionName);
    this._actions.unregister(qualifiedName);

    // Clean up empty app entry
    if (appCaps.size === 0) {
      this._capabilities.delete(appName);
    }
  }

  /**
   * Remove all capabilities for a micro-app (unmount cleanup).
   *
   * Call this when a micro-app is unmounted to prevent stale
   * capabilities from appearing in the AI's capability map.
   *
   * @param {string} appName
   * @returns {number} Number of capabilities removed
   */
  removeApp(appName) {
    const appCaps = this._capabilities.get(appName);
    if (!appCaps) return 0;

    let removed = 0;
    for (const [actionName] of appCaps) {
      const qualifiedName = `${appName}:${actionName}`;
      this._actions.unregister(qualifiedName);
      removed++;
    }

    this._capabilities.delete(appName);

    logger.wuDebug(`[wu-ai] All capabilities removed for app '${appName}' (${removed})`);

    this._eventBus.emit('ai:app:removed', {
      appName,
      capabilitiesRemoved: removed,
    }, { appName: 'wu-ai' });

    return removed;
  }

  // ─── Capability Map ─────────────────────────────────────────────

  /**
   * Get the full capability map grouped by app.
   *
   * Used for system prompt enrichment and debugging.
   *
   * @returns {object} { appName: [{ action, description }], ... }
   */
  getCapabilityMap() {
    const map = {};
    for (const [appName, actions] of this._capabilities) {
      map[appName] = [];
      for (const [, meta] of actions) {
        map[appName].push({
          action: meta.qualifiedName,
          description: meta.description,
        });
      }
    }
    return map;
  }

  /**
   * Get app names that have registered capabilities.
   *
   * @returns {string[]}
   */
  getRegisteredApps() {
    return [...this._capabilities.keys()];
  }

  /**
   * Check if an app has registered capabilities.
   *
   * @param {string} appName
   * @returns {boolean}
   */
  hasApp(appName) {
    return this._capabilities.has(appName);
  }

  /**
   * Get the total number of registered capabilities across all apps.
   *
   * @returns {number}
   */
  getTotalCapabilities() {
    let count = 0;
    for (const actions of this._capabilities.values()) {
      count += actions.size;
    }
    return count;
  }

  // ─── Intent Resolution ──────────────────────────────────────────

  /**
   * Resolve a cross-app intent in a single conversation turn.
   *
   * The AI receives:
   *   - The full capability map (what each app can do)
   *   - Current application state (via context)
   *   - Mounted apps list
   *   - All registered tools (capabilities are tools)
   *
   * Unlike agent(), this is NOT a multi-step autonomous loop.
   * The LLM resolves the intent in one logical request (which may
   * include multiple tool calls within the conversation's tool-call
   * loop, but conceptually is a single turn).
   *
   * Unlike send(), the namespace is ephemeral and auto-cleaned,
   * and the system prompt is auto-built with the capability map.
   *
   * @param {string} description - Natural language intent
   *   e.g., "Show me the top customer by order count"
   *   e.g., "Update dashboard stats and notify the topbar"
   * @param {object} [options]
   * @param {string[]} [options.plan] - Optional action sequence hint.
   *   The AI uses this as guidance but can deviate if needed.
   *   e.g., ['orders:getRecent', 'customers:lookup']
   * @param {string} [options.provider] - LLM provider override
   * @param {number} [options.temperature] - Temperature override
   * @param {number} [options.maxTokens] - Max tokens override
   * @param {AbortSignal} [options.signal] - Abort signal
   * @param {string|object} [options.responseFormat] - Response format
   * @returns {Promise<{
   *   content: string,
   *   tool_results: Array,
   *   usage: object|null,
   *   resolved: boolean,
   *   appsInvolved: string[]
   * }>}
   */
  async resolve(description, options = {}) {
    if (!description || typeof description !== 'string') {
      throw new Error('[wu-ai] intent() requires a description string');
    }

    this._stats.totalIntents++;
    const namespace = this._generateNamespace();

    // Collect fresh context before building the prompt
    if (this._context) {
      try {
        await this._context.collect();
      } catch {
        // Context collection is best-effort
      }
    }

    const systemPrompt = this._buildOrchestratorPrompt(options);

    this._eventBus.emit('ai:intent:start', {
      description: description.slice(0, 200),
      namespace,
      capabilities: this.getTotalCapabilities(),
    }, { appName: 'wu-ai' });

    try {
      const response = await this._conversation.send(description, {
        namespace,
        systemPrompt,
        provider: options.provider || this._config.defaultProvider,
        temperature: options.temperature ?? this._config.defaultTemperature,
        maxTokens: options.maxTokens,
        signal: options.signal,
        responseFormat: options.responseFormat,
      });

      const toolResults = response.tool_results || [];
      const appsInvolved = this._extractInvolvedApps(toolResults);
      const resolved = !!(response.content);

      if (resolved) {
        this._stats.resolvedIntents++;
      } else {
        this._stats.failedIntents++;
      }

      const result = {
        content: response.content || '',
        tool_results: toolResults,
        usage: response.usage || null,
        resolved,
        appsInvolved,
      };

      this._eventBus.emit('ai:intent:resolved', {
        description: description.slice(0, 200),
        resolved,
        appsInvolved,
      }, { appName: 'wu-ai' });

      return result;
    } catch (err) {
      this._stats.failedIntents++;

      this._eventBus.emit('ai:intent:error', {
        description: description.slice(0, 200),
        error: err.message,
      }, { appName: 'wu-ai' });

      throw err;
    } finally {
      // Always clean up the ephemeral namespace
      this._conversation.deleteNamespace(namespace);
    }
  }

  // ─── System Prompt Builder ──────────────────────────────────────

  /**
   * Build the orchestrator system prompt with full capability map.
   *
   * This method is also available to other modules (triggers, agents)
   * that want capability-aware system prompts.
   *
   * @param {object} [options]
   * @param {string[]} [options.plan] - Optional action sequence hint
   * @returns {string}
   */
  buildOrchestratorPrompt(options = {}) {
    return this._buildOrchestratorPrompt(options);
  }

  /** @private */
  _buildOrchestratorPrompt(options = {}) {
    const parts = [];

    parts.push(
      'You are an AI orchestrator for a microfrontend application.',
      'Multiple independent apps are mounted, each with specific capabilities.',
      'Resolve cross-app requests by calling the right capabilities in the right order.',
      '',
      'RULES:',
      '- Call capabilities (tools) to gather data or trigger actions.',
      '- You may call multiple capabilities from different apps if needed.',
      '- Synthesize results into a clear, actionable response.',
      '- If a required app is not available or lacks a capability, explain what is missing.',
      '',
    );

    // Capability map
    const capMap = this.getCapabilityMap();
    const appNames = Object.keys(capMap);

    if (appNames.length > 0) {
      parts.push('CAPABILITY MAP:');
      for (const appName of appNames) {
        parts.push(`  ${appName}:`);
        for (const cap of capMap[appName]) {
          parts.push(`    - ${cap.action}: ${cap.description}`);
        }
      }
      parts.push('');
    } else {
      parts.push(
        'NOTE: No app capabilities are registered. Answer based on available context only.',
        '',
      );
    }

    // Optional plan hint
    if (options.plan && options.plan.length > 0) {
      parts.push(
        'SUGGESTED PLAN (follow this unless a better approach is evident):',
      );
      for (let i = 0; i < options.plan.length; i++) {
        parts.push(`  ${i + 1}. ${options.plan[i]}`);
      }
      parts.push('');
    }

    // Context snapshot (state, mounted apps)
    const snapshot = this._context?.getSnapshot();
    if (snapshot?._mountedApps?.length) {
      parts.push(`MOUNTED APPS: ${snapshot._mountedApps.join(', ')}`, '');
    }
    if (snapshot?._store && Object.keys(snapshot._store).length > 0) {
      parts.push(
        'CURRENT STATE:',
        JSON.stringify(snapshot._store, null, 2),
        '',
      );
    }

    return parts.join('\n');
  }

  // ─── Workflows ─────────────────────────────────────────────────

  /**
   * Register a reusable AI workflow.
   *
   * A workflow is a named, parameterized recipe that the AI agent
   * follows step by step. Think of it as a macro: you define it once,
   * then run it whenever you need with different parameters.
   *
   * The AI receives the steps as instructions and uses browser actions
   * (screenshot, click, type) plus any registered capabilities/actions
   * to execute them. You can watch every step in real time.
   *
   * @param {string} name - Workflow name (e.g., 'register-user')
   * @param {object} config
   * @param {string} config.description - What this workflow does
   * @param {string[]} config.steps - Step-by-step instructions for the AI
   * @param {object} [config.parameters] - Parameter definitions for interpolation
   *   e.g., { name: { type: 'string', required: true }, email: { type: 'string' } }
   * @param {number} [config.maxSteps=15] - Max agent steps allowed
   * @param {string} [config.provider] - LLM provider to use
   * @param {number} [config.temperature] - Temperature (default: 0.2 for precision)
   *
   * @example
   * // ── AI Mode (default): steps are natural language ──
   * wu.ai.workflow('register-user', {
   *   description: 'Register a new user in the system',
   *   steps: [
   *     'Navigate to the Customers section',
   *     'Click the "Add Customer" button',
   *     'Fill in the name field with {{name}}',
   *     'Click Submit',
   *   ],
   *   parameters: { name: { type: 'string', required: true } },
   * });
   *
   * // ── Deterministic Mode: steps are exact actions, NO AI NEEDED ──
   * wu.ai.workflow('register-user', {
   *   mode: 'deterministic',
   *   description: 'Register a new user',
   *   steps: [
   *     { action: 'navigate', section: 'customers' },
   *     { action: 'click', selector: '#add-customer-btn' },
   *     { action: 'type', selector: '#name', value: '{{name}}' },
   *     { action: 'type', selector: '#email', value: '{{email}}' },
   *     { action: 'click', selector: '#submit-btn' },
   *     { action: 'wait', selector: '.success-message', timeout: 5000 },
   *   ],
   *   parameters: {
   *     name: { type: 'string', required: true },
   *     email: { type: 'string', required: true },
   *   },
   * });
   */
  registerWorkflow(name, config) {
    if (!name) {
      throw new Error('[wu-ai] workflow() requires a name');
    }
    if (!config || !config.steps || !Array.isArray(config.steps) || config.steps.length === 0) {
      throw new Error(`[wu-ai] workflow '${name}' must have a non-empty steps array`);
    }

    // Detect mode: if steps are objects with 'action', it's deterministic
    const mode = config.mode || (
      config.steps.length > 0 && typeof config.steps[0] === 'object' && config.steps[0].action
        ? 'deterministic'
        : 'ai'
    );

    this._workflows.set(name, {
      description: config.description || name,
      steps: config.steps,
      mode,
      parameters: config.parameters || {},
      maxSteps: config.maxSteps ?? 15,
      provider: config.provider || null,
      temperature: config.temperature ?? 0.2,
    });

    this._stats.workflowsRegistered++;

    logger.wuDebug(`[wu-ai] Workflow registered: '${name}' (${config.steps.length} steps)`);
  }

  /**
   * Execute a registered workflow with parameters.
   *
   * Returns an async generator (like agent) — you iterate over it
   * to observe each step in real time.
   *
   * @param {string} name - Workflow name
   * @param {object} [params={}] - Parameters to interpolate into steps
   *   e.g., { name: 'Juan Pérez', email: 'juan@test.com' }
   * @param {object} [options={}]
   * @param {Function} [options.onStep] - Callback per step
   * @param {Function} [options.shouldContinue] - Human-in-the-loop gate
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {AsyncGenerator<AgentStepResult>}
   *
   * @example
   * for await (const step of wu.ai.runWorkflow('register-user', {
   *   name: 'Juan Pérez',
   *   email: 'juan@test.com',
   * })) {
   *   console.log(`Paso ${step.step}: ${step.content}`);
   *   if (step.type === 'done') console.log('Workflow completado!');
   * }
   *
   * // With human approval per step:
   * for await (const step of wu.ai.runWorkflow('register-user', params, {
   *   shouldContinue: (step) => confirm(`¿Continuar? ${step.content?.slice(0, 60)}`),
   * })) {
   *   renderStep(step);
   * }
   */
  async *executeWorkflow(name, params = {}, options = {}) {
    const workflow = this._workflows.get(name);
    if (!workflow) {
      throw new Error(`[wu-ai] Workflow '${name}' is not registered`);
    }

    // Validate required parameters
    for (const [paramName, paramConfig] of Object.entries(workflow.parameters)) {
      if (paramConfig.required && (params[paramName] === undefined || params[paramName] === null)) {
        throw new Error(`[wu-ai] Workflow '${name}' requires parameter '${paramName}'`);
      }
    }

    this._stats.workflowsExecuted++;

    // Branch on mode
    if (workflow.mode === 'deterministic') {
      yield* this._executeDeterministic(name, workflow, params, options);
    } else {
      yield* this._executeWithAgent(name, workflow, params, options);
    }
  }

  /**
   * Execute workflow using the AI agent (natural language steps).
   * @private
   */
  async *_executeWithAgent(name, workflow, params, options) {
    if (!this._agent) {
      throw new Error('[wu-ai] Agent module not available for workflow execution');
    }

    // Interpolate parameters into string steps
    const interpolatedSteps = workflow.steps.map(step => {
      let result = step;
      for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      }
      return result;
    });

    const goal = this._buildWorkflowGoal(workflow, interpolatedSteps, params);

    this._eventBus.emit('ai:workflow:start', {
      workflow: name,
      mode: 'ai',
      params,
      steps: interpolatedSteps.length,
    }, { appName: 'wu-ai' });

    let finalStep = null;

    try {
      yield* this._agent.run(goal, {
        maxSteps: workflow.maxSteps,
        provider: options.provider || workflow.provider || this._config.defaultProvider,
        temperature: workflow.temperature ?? 0.2,
        onStep: (step) => {
          finalStep = step;
          if (options.onStep) options.onStep(step);
        },
        shouldContinue: options.shouldContinue,
        signal: options.signal,
      });
    } finally {
      this._eventBus.emit('ai:workflow:done', {
        workflow: name,
        params,
        totalSteps: finalStep?.step || 0,
        result: finalStep?.type || 'unknown',
      }, { appName: 'wu-ai' });
    }
  }

  /**
   * Execute workflow deterministically — NO AI NEEDED.
   * Steps are exact actions: { action: 'click', selector: '#btn' }
   * @private
   */
  async *_executeDeterministic(name, workflow, params, options) {
    // Interpolate parameters into step values
    const steps = workflow.steps.map(step => {
      const interpolated = { ...step };
      for (const [key, value] of Object.entries(params)) {
        const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        for (const field of ['value', 'selector', 'text', 'section', 'event', 'path']) {
          if (typeof interpolated[field] === 'string') {
            interpolated[field] = interpolated[field].replace(pattern, String(value));
          }
        }
      }
      return interpolated;
    });

    this._eventBus?.emit('ai:workflow:start', {
      workflow: name,
      mode: 'deterministic',
      params,
      steps: steps.length,
    }, { appName: 'wu-ai' });

    let lastStep = null;

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepNum = i + 1;
        const startTime = Date.now();

        // Check abort
        if (options.signal?.aborted) {
          const result = {
            step: stepNum,
            type: 'aborted',
            content: 'Workflow aborted',
            reason: 'Aborted by caller',
            elapsed: 0,
          };
          lastStep = result;
          yield result;
          return;
        }

        // Handle 'wait' specially — it's async
        if (step.action === 'wait') {
          if (step.selector) {
            const found = await waitForSelector(step.selector, step.timeout || 5000);
            const elapsed = Date.now() - startTime;
            const result = {
              step: stepNum,
              type: found ? 'action' : 'error',
              content: found
                ? `Waited for "${step.selector}" — found`
                : `Timeout waiting for "${step.selector}"`,
              elapsed,
            };
            lastStep = result;
            if (options.onStep) options.onStep(result);
            yield result;
            if (!found) return; // stop on timeout
          } else if (step.ms) {
            await delay(step.ms);
            const result = {
              step: stepNum,
              type: 'action',
              content: `Waited ${step.ms}ms`,
              elapsed: step.ms,
            };
            lastStep = result;
            if (options.onStep) options.onStep(result);
            yield result;
          }
          continue;
        }

        // Execute the step
        const execResult = executeDeterministicStep(step, this._eventBus, this._store);
        const elapsed = Date.now() - startTime;

        const stepResult = {
          step: stepNum,
          type: execResult.success ? 'action' : 'error',
          content: execResult.success ? execResult.detail : execResult.error,
          elapsed,
        };

        lastStep = stepResult;
        if (options.onStep) options.onStep(stepResult);
        yield stepResult;

        // Human-in-the-loop gate
        if (options.shouldContinue) {
          let shouldGo;
          try {
            shouldGo = await options.shouldContinue(stepResult);
          } catch {
            shouldGo = false;
          }
          if (!shouldGo) {
            const interrupted = {
              step: stepNum,
              type: 'interrupted',
              content: 'Stopped by user',
              reason: 'shouldContinue returned false',
              elapsed: 0,
            };
            lastStep = interrupted;
            yield interrupted;
            return;
          }
        }

        // Stop on error
        if (!execResult.success) return;

        // Small delay between steps for UI to update
        if (i < steps.length - 1) {
          await delay(step.delay ?? 200);
        }
      }

      // All steps completed
      const done = {
        step: steps.length,
        type: 'done',
        content: `Workflow "${name}" completed (${steps.length} steps)`,
        reason: 'All steps executed',
        elapsed: 0,
      };
      lastStep = done;
      if (options.onStep) options.onStep(done);
      yield done;

    } finally {
      this._eventBus?.emit('ai:workflow:done', {
        workflow: name,
        mode: 'deterministic',
        params,
        totalSteps: lastStep?.step || 0,
        result: lastStep?.type || 'unknown',
      }, { appName: 'wu-ai' });
    }
  }

  /**
   * Check if a workflow is registered.
   *
   * @param {string} name
   * @returns {boolean}
   */
  hasWorkflow(name) {
    return this._workflows.has(name);
  }

  /**
   * Get a workflow definition.
   *
   * @param {string} name
   * @returns {object|null}
   */
  getWorkflow(name) {
    const w = this._workflows.get(name);
    if (!w) return null;
    return {
      description: w.description,
      steps: [...w.steps],
      mode: w.mode,
      parameters: { ...w.parameters },
      maxSteps: w.maxSteps,
    };
  }

  /**
   * Remove a registered workflow.
   *
   * @param {string} name
   */
  removeWorkflow(name) {
    this._workflows.delete(name);
  }

  /**
   * Get all workflow names.
   *
   * @returns {string[]}
   */
  getWorkflowNames() {
    return [...this._workflows.keys()];
  }

  /** @private */
  _buildWorkflowGoal(workflow, steps, params) {
    const parts = [];

    parts.push(
      `WORKFLOW: ${workflow.description}`,
      '',
      'You must follow these steps IN ORDER. Use browser tools (screenshot, click, type)',
      'to interact with the application. After each step, take a screenshot to verify.',
      '',
      'STEPS:',
    );

    for (let i = 0; i < steps.length; i++) {
      parts.push(`  ${i + 1}. ${steps[i]}`);
    }

    parts.push(
      '',
      'After completing all steps successfully, respond with [DONE].',
      'If a step fails, explain what went wrong.',
    );

    // Add capability context if available
    const capMap = this.getCapabilityMap();
    const appNames = Object.keys(capMap);
    if (appNames.length > 0) {
      parts.push('', 'AVAILABLE APP CAPABILITIES:');
      for (const appName of appNames) {
        for (const cap of capMap[appName]) {
          parts.push(`  - ${cap.action}: ${cap.description}`);
        }
      }
    }

    return parts.join('\n');
  }

  // ─── Stats & Lifecycle ──────────────────────────────────────────

  getStats() {
    return {
      ...this._stats,
      registeredApps: this.getRegisteredApps(),
      totalCapabilities: this.getTotalCapabilities(),
      capabilityMap: this.getCapabilityMap(),
      workflows: this.getWorkflowNames(),
      config: { ...this._config },
    };
  }

  destroy() {
    // Remove all capabilities from the action registry
    for (const [appName, actions] of this._capabilities) {
      for (const [actionName] of actions) {
        this._actions.unregister(`${appName}:${actionName}`);
      }
    }
    this._capabilities.clear();
    this._workflows.clear();

    this._stats = {
      totalIntents: 0,
      resolvedIntents: 0,
      failedIntents: 0,
      workflowsRegistered: 0,
      workflowsExecuted: 0,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────

  /**
   * Extract app names from tool results based on qualified action names.
   * e.g., tool name 'orders:getRecent' → app 'orders'
   */
  _extractInvolvedApps(toolResults) {
    if (!toolResults || !Array.isArray(toolResults)) return [];
    const apps = new Set();
    for (const result of toolResults) {
      const name = result.name || result.tool || '';
      const colonIdx = name.indexOf(':');
      if (colonIdx > 0) {
        apps.add(name.slice(0, colonIdx));
      }
    }
    return [...apps];
  }

  _generateNamespace() {
    return INTENT_NAMESPACE_PREFIX + Date.now().toString(36) +
      '_' + Math.random().toString(36).slice(2, 6);
  }
}
