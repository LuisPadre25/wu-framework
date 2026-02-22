/**
 * WU-AI: Central orchestrator for AI integration
 *
 * This is the main entry point for wu.ai — it wires together all sub-modules
 * and exposes the public API. Lazy-initialized on first use.
 *
 * Architecture:
 *   WuAI (this file)
 *     ├── WuAIProvider         → BYOL provider management (OpenAI, Anthropic, Ollama, Custom)
 *     ├── WuAIPermissions      → 4-layer security (perms, rate limit, circuit breaker, loop guard)
 *     ├── WuAIContext           → Auto context collection with token budget
 *     ├── WuAIActions           → Tool/action registry and sandboxed execution
 *     ├── WuAIConversation      → Multi-turn conversation manager with namespaces
 *     ├── WuAITriggers          → Event-to-AI reactive bridge
 *     ├── WuAIAgent             → Autonomous agent loop (goal → steps → done)
 *     ├── WuAIOrchestrate       → Cross-micro-app AI coordination (capabilities + intents)
 *     └── BrowserPrimitives     → Shared screenshot, click, type, a11y tree, interceptors
 *
 * Four Paradigms:
 *   1. App → LLM    send/stream/json → conversation with tool loops
 *   2. LLM → App    tools/execute/expose → external agents call into the app
 *   3. AI Director  agent(goal) → autonomous multi-step loop
 *   4. MF Glue      capability/intent → cross-app coordination via AI
 *
 * Public API (accessible via wu.ai):
 *   wu.ai.provider(name, config)   → Register LLM provider
 *   wu.ai.send(message, opts)      → Send message (non-streaming)
 *   wu.ai.stream(message, opts)    → Send message (streaming)
 *   wu.ai.json(message, schema?)   → Send and get parsed JSON back
 *   wu.ai.agent(goal, opts)        → Run autonomous agent loop
 *   wu.ai.action(name, config)     → Register an action/tool
 *   wu.ai.trigger(name, config)    → Register an event trigger
 *   wu.ai.capability(app, name, c) → Register app-scoped capability
 *   wu.ai.intent(desc, opts)       → Resolve cross-app intent
 *   wu.ai.removeApp(appName)       → Remove app capabilities (unmount)
 *   wu.ai.workflow(name, config)   → Register reusable AI workflow
 *   wu.ai.runWorkflow(name, params)→ Execute workflow (async generator)
 *   wu.ai.context.configure(...)   → Configure context collection
 *   wu.ai.abort(namespace?)        → Abort active request
 *
 * Paradigm 2 (External agent access):
 *   wu.ai.tools()                  → Get all registered tools (for CDP/WebMCP)
 *   wu.ai.execute(name, params)    → Execute action directly (for external agents)
 *   wu.ai.expose()                 → Register tools via WebMCP (navigator.modelContext)
 */

import { logger } from '../core/wu-logger.js';
import { WuAIProvider } from './wu-ai-provider.js';
import { WuAIPermissions } from './wu-ai-permissions.js';
import { WuAIContext } from './wu-ai-context.js';
import { WuAIActions } from './wu-ai-actions.js';
import { WuAIConversation } from './wu-ai-conversation.js';
import { WuAITriggers } from './wu-ai-triggers.js';
import { WuAIAgent } from './wu-ai-agent.js';
import { WuAIOrchestrate } from './wu-ai-orchestrate.js';
import { registerBrowserActions } from './wu-ai-browser.js';

export class WuAI {
  /**
   * @param {object} deps - Injected from WuCore
   * @param {object} deps.eventBus - WuEventBus instance
   * @param {object} deps.store - WuStore instance
   * @param {object} deps.core - WuCore instance (for mounted apps)
   */
  constructor({ eventBus, store, core }) {
    this._eventBus = eventBus;
    this._store = store;
    this._core = core;
    this._initialized = false;
    this._modules = {};
  }

  // ─── Lazy Initialization ───────────────────────────────────────

  /**
   * Initialize all sub-modules. Called automatically on first use,
   * or can be called explicitly with configuration.
   *
   * @param {object} [config]
   * @param {object} [config.permissions] - Permission overrides
   * @param {object} [config.rateLimit] - Rate limit config
   * @param {object} [config.circuitBreaker] - Circuit breaker config
   * @param {object} [config.loopProtection] - Loop protection config
   * @param {object} [config.context] - Context collection config
   * @param {object} [config.conversation] - Conversation defaults
   * @param {object} [config.triggers] - Trigger system config
   */
  init(config = {}) {
    if (this._initialized) {
      // Reconfigure if already initialized
      this._reconfigure(config);
      return this;
    }

    // 1. Permissions (independent — no deps)
    this._modules.permissions = new WuAIPermissions({
      permissions: config.permissions,
      rateLimit: config.rateLimit,
      circuitBreaker: config.circuitBreaker,
      loopProtection: config.loopProtection,
      allowedDomains: config.allowedDomains,
    });

    // 2. Provider (independent — no deps)
    this._modules.provider = new WuAIProvider();

    // 3. Context (depends on store, eventBus, core)
    this._modules.context = new WuAIContext({
      store: this._store,
      eventBus: this._eventBus,
      core: this._core,
    });
    if (config.context) {
      this._modules.context.configure(config.context);
    }

    // 4. Actions (depends on eventBus, store, permissions)
    this._modules.actions = new WuAIActions({
      eventBus: this._eventBus,
      store: this._store,
      permissions: this._modules.permissions,
    });

    // 5. Conversation (depends on provider, actions, context, permissions, eventBus)
    this._modules.conversation = new WuAIConversation({
      provider: this._modules.provider,
      actions: this._modules.actions,
      context: this._modules.context,
      permissions: this._modules.permissions,
      eventBus: this._eventBus,
    });
    if (config.conversation) {
      this._modules.conversation.configure(config.conversation);
    }

    // 6. Triggers (depends on eventBus, conversation, permissions)
    this._modules.triggers = new WuAITriggers({
      eventBus: this._eventBus,
      conversation: this._modules.conversation,
      permissions: this._modules.permissions,
    });
    if (config.triggers) {
      this._modules.triggers.configure(config.triggers);
    }

    // 7. Agent (depends on conversation, actions, context, permissions, eventBus)
    this._modules.agent = new WuAIAgent({
      conversation: this._modules.conversation,
      actions: this._modules.actions,
      context: this._modules.context,
      permissions: this._modules.permissions,
      eventBus: this._eventBus,
    });
    if (config.agent) {
      this._modules.agent.configure(config.agent);
    }

    // 8. Orchestrate — Paradigm 4: AI as microfrontend glue
    //    Agent ref is passed so workflows can delegate to the agent loop
    //    Store ref is passed for deterministic setState steps
    this._modules.orchestrate = new WuAIOrchestrate({
      actions: this._modules.actions,
      conversation: this._modules.conversation,
      context: this._modules.context,
      permissions: this._modules.permissions,
      eventBus: this._eventBus,
      agent: this._modules.agent,
      store: this._store,
    });
    if (config.orchestrate) {
      this._modules.orchestrate.configure(config.orchestrate);
    }

    this._initialized = true;
    logger.wuInfo('[wu-ai] Initialized');

    // 9. Browser automation actions (screenshot, click, type, network, etc.)
    // Must be AFTER _initialized = true to prevent recursive init loop
    if (typeof window !== 'undefined') {
      registerBrowserActions(this, this._core);
      logger.wuInfo('[wu-ai] Browser actions registered (10 tools)');
    }

    this._eventBus.emit('ai:initialized', {}, { appName: 'wu-ai' });

    return this;
  }

  // ─── Provider Management ───────────────────────────────────────

  /**
   * Register an LLM provider.
   *
   * @param {string} name - Provider name ('openai', 'anthropic', 'ollama', or custom)
   * @param {object} config - { endpoint, apiKey?, model?, adapter?, send?, stream? }
   *
   * @example
   * // OpenAI via proxy (recommended)
   * wu.ai.provider('openai', { endpoint: '/api/ai/chat', model: 'gpt-4o' });
   *
   * // Anthropic direct (development only)
   * wu.ai.provider('anthropic', {
   *   endpoint: 'https://api.anthropic.com/v1/messages',
   *   apiKey: 'sk-...',
   *   model: 'claude-sonnet-4-5-20250929',
   * });
   *
   * // Local Ollama
   * wu.ai.provider('ollama', { endpoint: 'http://localhost:11434/api/chat', model: 'llama3' });
   *
   * // Custom provider
   * wu.ai.provider('my-llm', { send: async (messages, opts) => ({ content: '...' }) });
   */
  provider(name, config) {
    this._ensureInit();
    this._modules.provider.register(name, config);
    return this;
  }

  // ─── Paradigm 1: App → LLM (Conversation) ─────────────────────

  /**
   * Send a message to the LLM and get a complete response.
   *
   * @param {string} message - User message
   * @param {object} [options] - { namespace, systemPrompt, templateVars, temperature, maxTokens, provider, responseFormat, signal }
   * @param {string} [options.provider] - Use a specific registered provider (e.g., 'anthropic', 'openai')
   * @param {string|object} [options.responseFormat] - Request JSON output.
   *   - `'json'` — simple JSON mode (OpenAI: json_object, Ollama: format:"json", Anthropic: prompt injection)
   *   - `{ type: 'json_schema', schema: {...}, name?: string }` — structured output with JSON Schema
   *     (OpenAI: native json_schema mode, Ollama: schema in format, Anthropic: schema in system prompt)
   * @returns {Promise<{ content: string, tool_results?: Array, usage?: object, namespace: string }>}
   *
   * @example
   * const response = await wu.ai.send('What items are in the cart?');
   * console.log(response.content);
   *
   * // With namespace for separate conversation
   * const response = await wu.ai.send('Analyze this chart', { namespace: 'analytics' });
   *
   * // Use a specific provider for this message
   * const response = await wu.ai.send('Translate this', { provider: 'anthropic' });
   *
   * // Simple JSON mode
   * const response = await wu.ai.send('List 5 colors', { responseFormat: 'json' });
   *
   * // Structured output with JSON Schema
   * const response = await wu.ai.send('List 5 colors', {
   *   responseFormat: {
   *     type: 'json_schema',
   *     schema: { type: 'object', properties: { colors: { type: 'array', items: { type: 'string' } } } },
   *     name: 'color_list',
   *   },
   * });
   */
  async send(message, options = {}) {
    this._ensureInit();
    return this._modules.conversation.send(message, options);
  }

  /**
   * Send a message and stream the response.
   *
   * @param {string} message - User message
   * @param {object} [options] - Same as send()
   * @yields {{ type: 'text'|'tool_result'|'done'|'error', content?: string }}
   *
   * @example
   * for await (const chunk of wu.ai.stream('Tell me about this page')) {
   *   if (chunk.type === 'text') outputEl.textContent += chunk.content;
   *   if (chunk.type === 'done') console.log('Done!');
   * }
   */
  async *stream(message, options = {}) {
    this._ensureInit();
    yield* this._modules.conversation.stream(message, options);
  }

  /**
   * Send a message and get a parsed JSON response.
   * Shortcut for send() with responseFormat + automatic JSON.parse().
   *
   * @param {string} message - User message
   * @param {object} [options] - All send() options plus:
   * @param {object} [options.schema] - JSON Schema for structured output
   * @param {string} [options.schemaName='response'] - Schema name (required by OpenAI)
   * @returns {Promise<{ data: object|null, raw: string, error?: string, usage?: object, namespace: string }>}
   *
   * @example
   * // Simple JSON (no schema)
   * const { data } = await wu.ai.json('List 5 colors as a JSON array');
   * // data = ["red", "blue", ...]
   *
   * // With schema
   * const { data } = await wu.ai.json('List 5 colors', {
   *   schema: { type: 'object', properties: { colors: { type: 'array', items: { type: 'string' } } } },
   * });
   * // data = { colors: ["red", "blue", ...] }
   *
   * // With schema + provider
   * const { data } = await wu.ai.json('List 5 colors', {
   *   schema: mySchema,
   *   provider: 'openai',
   *   temperature: 0,
   * });
   */
  async json(message, options = {}) {
    this._ensureInit();

    const { schema, schemaName, ...rest } = options;

    let responseFormat;
    if (schema) {
      responseFormat = { type: 'json_schema', schema, name: schemaName || 'response' };
    } else {
      responseFormat = options.responseFormat || 'json';
    }

    const response = await this._modules.conversation.send(message, { ...rest, responseFormat });

    // The provider already attempts parse and sets response.parsed / response.parseError
    let data = null;
    let error;

    if (response.parsed !== undefined) {
      data = response.parsed;
    } else if (response.content) {
      try {
        data = JSON.parse(response.content);
      } catch {
        error = 'LLM response is not valid JSON';
      }
    }

    return {
      data,
      raw: response.content || '',
      error: error || response.parseError,
      usage: response.usage,
      namespace: response.namespace,
    };
  }

  /**
   * Abort active request(s).
   *
   * @param {string} [namespace] - Specific namespace, or all if omitted
   */
  abort(namespace) {
    if (!this._initialized) return;
    if (namespace) {
      this._modules.conversation.abort(namespace);
    } else {
      this._modules.conversation.abortAll();
    }
  }

  // ─── Actions / Tools ───────────────────────────────────────────

  /**
   * Register an action that the LLM can call.
   *
   * @param {string} name - Action name (used in tool_call)
   * @param {object} config - { description, parameters, handler, confirm?, permissions?, dangerous? }
   *
   * @example
   * wu.ai.action('addToCart', {
   *   description: 'Add an item to the shopping cart',
   *   parameters: {
   *     productId: { type: 'string', required: true },
   *     quantity: { type: 'number' },
   *   },
   *   handler: async (params, api) => {
   *     api.setState('cart.items', [...api.getState('cart.items'), params]);
   *     api.emit('cart:updated', params);
   *     return { added: params.productId };
   *   },
   *   confirm: true, // require user confirmation
   * });
   */
  action(name, config) {
    this._ensureInit();
    this._modules.actions.register(name, config);
    return this;
  }

  /**
   * Execute an action directly (used by external agents via CDP/WebMCP).
   *
   * @param {string} name - Action name
   * @param {object} params - Parameters
   * @returns {Promise<{ success: boolean, result?: any, reason?: string }>}
   */
  async execute(name, params) {
    this._ensureInit();
    const traceId = this._modules.permissions.loopProtection.createTraceId();
    return this._modules.actions.execute(name, params, { traceId, depth: 0 });
  }

  // ─── Triggers (Reactive AI) ────────────────────────────────────

  /**
   * Register a trigger that automatically sends messages to the LLM
   * when specific events occur.
   *
   * @param {string} name - Trigger name
   * @param {object} config - { pattern, prompt, condition?, debounce?, priority?, onResult? }
   *
   * @example
   * wu.ai.trigger('cartAnalysis', {
   *   pattern: 'cart:updated',
   *   prompt: 'The cart was updated: {{data}}. Suggest complementary products.',
   *   debounce: 3000,
   *   priority: 'low',
   *   onResult: (result) => {
   *     wu.emit('ai:suggestions', { suggestions: result.content });
   *   },
   * });
   */
  trigger(name, config) {
    this._ensureInit();
    this._modules.triggers.register(name, config);
    return this;
  }

  /**
   * Fire a trigger manually.
   */
  async fireTrigger(name, eventData) {
    this._ensureInit();
    return this._modules.triggers.fire(name, eventData);
  }

  // ─── Agent (Paradigm 3: Autonomous AI) ─────────────────────────

  /**
   * Run an autonomous agent that pursues a goal using available tools.
   * Returns an async generator that yields step-by-step results.
   *
   * @param {string} goal - What the agent should accomplish
   * @param {object} [options]
   * @param {number} [options.maxSteps=10] - Maximum autonomous steps
   * @param {string} [options.provider] - Which LLM provider to use
   * @param {string} [options.namespace] - Conversation namespace
   * @param {string} [options.systemPrompt] - Override system prompt
   * @param {Function} [options.onStep] - Callback per step: (stepResult) => void
   * @param {Function} [options.shouldContinue] - Human-in-the-loop: (stepResult) => boolean|Promise<boolean>
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {AsyncGenerator<AgentStepResult>}
   *
   * @example
   * // Basic usage
   * for await (const step of wu.ai.agent('Find all orders above $100 and summarize them')) {
   *   console.log(`Step ${step.step}: ${step.content?.slice(0, 100)}`);
   *   if (step.done) console.log('Agent finished!');
   * }
   *
   * // With human-in-the-loop
   * for await (const step of wu.ai.agent('Reorganize the product catalog', {
   *   shouldContinue: (step) => confirm(`Continue? Step ${step.step}: ${step.content?.slice(0, 50)}`),
   * })) {
   *   updateUI(step);
   * }
   */
  async *agent(goal, options = {}) {
    this._ensureInit();
    yield* this._modules.agent.run(goal, options);
  }

  // ─── Paradigm 4: AI as Microfrontend Glue ─────────────────────

  /**
   * Register a capability scoped to a specific micro-app.
   *
   * Each micro-app calls this to declare what it can do. The AI uses
   * the capability map to resolve cross-app intents.
   *
   * @param {string} appName - The micro-app name (e.g., 'orders', 'dashboard')
   * @param {string} actionName - The capability name (e.g., 'getRecent', 'updateKPIs')
   * @param {object} config - Same as wu.ai.action() config:
   *   { description, parameters, handler, confirm?, permissions?, dangerous? }
   *
   * @example
   * // In orders micro-app (React):
   * wu.ai.capability('orders', 'getRecent', {
   *   description: 'Get the N most recent orders',
   *   parameters: { limit: { type: 'number' } },
   *   handler: async (params) => fetchOrders({ limit: params.limit || 10 }),
   * });
   *
   * // In dashboard micro-app (Svelte):
   * wu.ai.capability('dashboard', 'updateKPIs', {
   *   description: 'Refresh the KPI cards with latest data',
   *   handler: async () => { refreshKPIs(); return { updated: true }; },
   * });
   */
  capability(appName, actionName, config) {
    this._ensureInit();
    this._modules.orchestrate.register(appName, actionName, config);
    return this;
  }

  /**
   * Resolve a cross-app intent in a single conversation turn.
   *
   * The AI receives the full capability map (what each app can do),
   * current application state, and mounted apps. It resolves the
   * intent by calling the right capabilities across app boundaries.
   *
   * @param {string} description - Natural language intent
   * @param {object} [options]
   * @param {string[]} [options.plan] - Optional action sequence hint
   * @param {string} [options.provider] - LLM provider override
   * @param {number} [options.temperature] - Temperature override
   * @param {number} [options.maxTokens] - Max tokens override
   * @param {AbortSignal} [options.signal] - Abort signal
   * @param {string|object} [options.responseFormat] - Response format
   * @returns {Promise<{ content: string, tool_results: Array, usage: object|null, resolved: boolean, appsInvolved: string[] }>}
   *
   * @example
   * // Simple cross-app query
   * const result = await wu.ai.intent('Show me the top customer by order count');
   * // AI calls orders:getRecent → aggregates → returns answer
   *
   * // With plan hint
   * const result = await wu.ai.intent('Update all views after a new order', {
   *   plan: ['orders:getRecent', 'dashboard:updateKPIs', 'analytics:refresh'],
   * });
   *
   * // With JSON response
   * const result = await wu.ai.intent('Get order stats by status', {
   *   responseFormat: 'json',
   * });
   */
  async intent(description, options = {}) {
    this._ensureInit();
    return this._modules.orchestrate.resolve(description, options);
  }

  /**
   * Remove all capabilities for a micro-app.
   * Call this when a micro-app is unmounted to prevent stale
   * capabilities from appearing in the AI's capability map.
   *
   * @param {string} appName - The micro-app name
   *
   * @example
   * // In unmount lifecycle:
   * wu.ai.removeApp('orders');
   */
  removeApp(appName) {
    this._ensureInit();
    this._modules.orchestrate.removeApp(appName);
    return this;
  }

  /**
   * Register a reusable AI workflow — a named, step-by-step recipe
   * that the AI agent follows using browser automation.
   *
   * @param {string} name - Workflow name (e.g., 'register-user')
   * @param {object} config
   * @param {string} config.description - What this workflow does
   * @param {string[]} config.steps - Step-by-step instructions
   *   Use {{paramName}} for parameter interpolation.
   * @param {object} [config.parameters] - Parameter definitions
   * @param {number} [config.maxSteps=15] - Max agent steps
   * @param {string} [config.provider] - LLM provider
   *
   * @example
   * wu.ai.workflow('register-user', {
   *   description: 'Register a new user in the system',
   *   steps: [
   *     'Navigate to the Customers section',
   *     'Click the "Add Customer" button',
   *     'Type "{{name}}" into the name field',
   *     'Type "{{email}}" into the email field',
   *     'Click Submit',
   *     'Verify the success message appears',
   *   ],
   *   parameters: {
   *     name: { type: 'string', required: true },
   *     email: { type: 'string', required: true },
   *   },
   * });
   */
  workflow(name, config) {
    this._ensureInit();
    this._modules.orchestrate.registerWorkflow(name, config);
    return this;
  }

  /**
   * Execute a registered workflow. Returns an async generator
   * so you can observe each step in real time.
   *
   * @param {string} name - Workflow name
   * @param {object} [params={}] - Parameters to fill into the steps
   * @param {object} [options={}]
   * @param {Function} [options.onStep] - Callback per step
   * @param {Function} [options.shouldContinue] - Human-in-the-loop gate
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {AsyncGenerator<AgentStepResult>}
   *
   * @example
   * // Run and watch every step
   * for await (const step of wu.ai.runWorkflow('register-user', {
   *   name: 'Juan Pérez',
   *   email: 'juan@test.com',
   * })) {
   *   console.log(`Step ${step.step}: ${step.content}`);
   *   if (step.type === 'done') console.log('Workflow complete!');
   * }
   *
   * // With human approval per step
   * for await (const step of wu.ai.runWorkflow('register-user', params, {
   *   shouldContinue: (s) => confirm(`Continue? ${s.content?.slice(0, 60)}`),
   * })) {
   *   renderStep(step);
   * }
   */
  async *runWorkflow(name, params = {}, options = {}) {
    this._ensureInit();
    yield* this._modules.orchestrate.executeWorkflow(name, params, options);
  }

  // ─── Context ───────────────────────────────────────────────────

  /**
   * Context configuration sub-API.
   * Access via wu.ai.context
   */
  get context() {
    this._ensureInit();
    return {
      configure: (config) => this._modules.context.configure(config),
      register: (name, config) => this._modules.context.register(name, config),
      collect: () => this._modules.context.collect(),
      getSnapshot: () => this._modules.context.getSnapshot(),
    };
  }

  // ─── Conversation Management ───────────────────────────────────

  /**
   * Conversation sub-API for direct history management.
   */
  get conversation() {
    this._ensureInit();
    return {
      getHistory: (ns) => this._modules.conversation.getHistory(ns),
      clear: (ns) => this._modules.conversation.clear(ns),
      clearAll: () => this._modules.conversation.clearAll(),
      inject: (role, content, opts) => this._modules.conversation.inject(role, content, opts),
      getNamespaces: () => this._modules.conversation.getNamespaces(),
      deleteNamespace: (ns) => this._modules.conversation.deleteNamespace(ns),
    };
  }

  // ─── Permissions ───────────────────────────────────────────────

  /**
   * Permissions sub-API.
   */
  get permissions() {
    this._ensureInit();
    return {
      configure: (config) => this._modules.permissions.configure(config),
      check: (perm) => this._modules.permissions.check(perm),
      getPermissions: () => this._modules.permissions.getPermissions(),
      setAllowedDomains: (domains) => this._modules.permissions.setAllowedDomains(domains),
    };
  }

  // ─── Paradigm 2: LLM → App (External Agent Access) ────────────

  /**
   * Get all registered tools (for external agents).
   * An agent connected via CDP can call: window.wu.ai.tools()
   *
   * @returns {Array<{ name, description, parameters }>}
   */
  tools() {
    this._ensureInit();
    return this._modules.actions.getToolSchemas();
  }

  /**
   * Expose tools via WebMCP (Chrome 146+ / W3C proposal).
   * Registers all actions with navigator.modelContext.registerTool()
   *
   * @returns {boolean} Whether WebMCP is available
   */
  expose() {
    this._ensureInit();

    if (typeof navigator === 'undefined' || !navigator.modelContext) {
      logger.wuDebug('[wu-ai] WebMCP not available (navigator.modelContext missing)');
      return false;
    }

    const tools = this._modules.actions.getToolSchemas();
    const actionNames = this._modules.actions.getNames();

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const actionName = actionNames[i];

      try {
        navigator.modelContext.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
          handler: async (params) => {
            const result = await this.execute(actionName, params);
            return result.success ? result.result : { error: result.reason };
          },
        });
      } catch (err) {
        logger.wuDebug(`[wu-ai] WebMCP register failed for '${tool.name}': ${err.message}`);
      }
    }

    logger.wuInfo(`[wu-ai] Exposed ${tools.length} tools via WebMCP`);

    this._eventBus.emit('ai:webmcp:exposed', {
      toolCount: tools.length,
      tools: tools.map(t => t.name),
    }, { appName: 'wu-ai' });

    return true;
  }

  /**
   * Confirm a pending tool call (for UI integration).
   */
  confirmTool(callId) {
    if (!this._initialized) return;
    this._modules.actions.confirmTool(callId);
  }

  /**
   * Reject a pending tool call.
   */
  rejectTool(callId) {
    if (!this._initialized) return;
    this._modules.actions.rejectTool(callId);
  }

  // ─── Stats & Debug ─────────────────────────────────────────────

  getStats() {
    if (!this._initialized) return { initialized: false };

    return {
      initialized: true,
      provider: this._modules.provider.getStats(),
      permissions: this._modules.permissions.getStats(),
      context: this._modules.context.getStats(),
      actions: this._modules.actions.getStats(),
      conversation: this._modules.conversation.getStats(),
      triggers: this._modules.triggers.getStats(),
      agent: this._modules.agent.getStats(),
      orchestrate: this._modules.orchestrate.getStats(),
    };
  }

  /**
   * Destroy the AI system and clean up all resources.
   */
  destroy() {
    if (!this._initialized) return;

    this._modules.orchestrate.destroy();
    this._modules.agent.destroy();
    this._modules.conversation.abortAll();
    this._modules.triggers.destroy();
    this._modules = {};
    this._initialized = false;

    logger.wuInfo('[wu-ai] Destroyed');
    this._eventBus.emit('ai:destroyed', {}, { appName: 'wu-ai' });
  }

  // ─── Private ───────────────────────────────────────────────────

  _ensureInit() {
    if (!this._initialized) {
      this.init();
    }
  }

  _reconfigure(config) {
    if (config.permissions) this._modules.permissions.configure(config.permissions);
    if (config.rateLimit) this._modules.permissions.rateLimiter.configure(config.rateLimit);
    if (config.circuitBreaker) this._modules.permissions.circuitBreaker.configure(config.circuitBreaker);
    if (config.loopProtection) this._modules.permissions.loopProtection.configure(config.loopProtection);
    if (config.context) this._modules.context.configure(config.context);
    if (config.conversation) this._modules.conversation.configure(config.conversation);
    if (config.triggers) this._modules.triggers.configure(config.triggers);
    if (config.agent) this._modules.agent.configure(config.agent);
    if (config.orchestrate) this._modules.orchestrate.configure(config.orchestrate);
  }
}
