/**
 * WU-AI-TRIGGERS: Event-to-AI bridge
 *
 * Listens to wu.eventBus events and automatically triggers LLM interactions.
 * This is the "reactive AI" — the app becomes intelligent by responding
 * to events with AI-generated actions.
 *
 * Features:
 * - Pattern-based event matching (wu convention: 'cart:*', 'user:login')
 * - Debounce per trigger (avoid flooding LLM)
 * - Conditional execution (only trigger if condition returns true)
 * - Priority batching (high triggers fire immediately, low ones batch)
 * - Template interpolation ({{event.data.user}} in prompts)
 * - Namespace isolation (each trigger uses its own conversation namespace)
 */

import { logger } from '../core/wu-logger.js';
import { interpolate, sanitizeForPrompt } from './wu-ai-schema.js';

// ─── Trigger Config ──────────────────────────────────────────────

const DEFAULT_TRIGGER_CONFIG = {
  enabled: true,
  maxActiveTriggers: 20,
  defaultDebounceMs: 1000,
  batchIntervalMs: 2000,
};

// ─── Single Trigger ──────────────────────────────────────────────

class Trigger {
  constructor(name, config) {
    this.name = name;
    this.pattern = config.pattern;         // event pattern: 'cart:updated', 'user:*'
    this.prompt = config.prompt;           // string or function(eventData) → string
    this.condition = config.condition || null; // function(eventData) → boolean
    this.debounceMs = config.debounce ?? DEFAULT_TRIGGER_CONFIG.defaultDebounceMs;
    this.priority = config.priority || 'medium'; // 'high' | 'medium' | 'low'
    this.namespace = config.namespace || `trigger:${name}`;
    this.systemPrompt = config.systemPrompt || null;
    this.onResult = config.onResult || null; // callback(result, eventData) → void
    this.enabled = config.enabled !== false;
    this.maxTokens = config.maxTokens || undefined;
    this.temperature = config.temperature || undefined;

    // Internal state
    this._debounceTimer = null;
    this._lastFired = 0;
    this._fireCount = 0;
    this._pendingEvent = null;
  }

  /**
   * Check if this trigger matches an event name.
   */
  matches(eventName) {
    if (!this.pattern) return false;
    if (this.pattern === '*') return true;
    if (!this.pattern.includes('*')) return eventName === this.pattern;

    const regex = new RegExp('^' + this.pattern.replace(/\*/g, '[^:]*') + '$');
    return regex.test(eventName);
  }

  /**
   * Build the prompt for this trigger given event data.
   */
  buildPrompt(eventData) {
    if (typeof this.prompt === 'function') {
      return this.prompt(eventData);
    }

    // Template interpolation
    return interpolate(this.prompt, {
      event: eventData,
      data: eventData?.data,
      timestamp: Date.now(),
    });
  }

  /**
   * Check condition (if any).
   */
  async checkCondition(eventData) {
    if (!this.condition) return true;
    try {
      const result = this.condition(eventData);
      return result instanceof Promise ? await result : result;
    } catch (err) {
      logger.wuDebug(`[wu-ai] Trigger '${this.name}' condition error: ${err.message}`);
      return false;
    }
  }
}

// ─── Main Triggers Manager ───────────────────────────────────────

export class WuAITriggers {
  constructor({ eventBus, conversation, permissions }) {
    this._eventBus = eventBus;
    this._conversation = conversation;
    this._permissions = permissions;

    this._config = { ...DEFAULT_TRIGGER_CONFIG };
    this._triggers = new Map();          // name → Trigger
    this._listeners = new Map();         // name → unsubscribe function
    this._batchQueue = [];               // low-priority triggers pending batch
    this._batchTimer = null;
    this._stats = {
      totalFired: 0,
      totalSkipped: 0,
      totalErrors: 0,
    };
  }

  /**
   * Configure trigger system.
   */
  configure(config) {
    Object.assign(this._config, config);
  }

  /**
   * Register a trigger.
   *
   * @param {string} name - Trigger name (unique identifier)
   * @param {object} config
   * @param {string} config.pattern - Event pattern to match (e.g., 'cart:*')
   * @param {string|Function} config.prompt - Prompt template or function
   * @param {Function} [config.condition] - Optional condition function
   * @param {number} [config.debounce=1000] - Debounce in ms
   * @param {string} [config.priority='medium'] - 'high' | 'medium' | 'low'
   * @param {string} [config.namespace] - Conversation namespace
   * @param {string} [config.systemPrompt] - Override system prompt
   * @param {Function} [config.onResult] - Callback for results
   * @param {boolean} [config.enabled=true] - Whether trigger is active
   */
  register(name, config) {
    if (this._triggers.size >= this._config.maxActiveTriggers) {
      logger.wuWarn(`[wu-ai] Max triggers (${this._config.maxActiveTriggers}) reached. Cannot register '${name}'.`);
      return;
    }

    // Unregister existing trigger with same name
    if (this._triggers.has(name)) {
      this.unregister(name);
    }

    const trigger = new Trigger(name, config);
    this._triggers.set(name, trigger);

    // Subscribe to matching events
    const handler = (eventData) => this._handleEvent(name, eventData);
    const unsub = this._eventBus.on(trigger.pattern, handler);
    this._listeners.set(name, unsub);

    logger.wuDebug(`[wu-ai] Trigger registered: '${name}' → pattern '${trigger.pattern}' (${trigger.priority})`);
  }

  /**
   * Unregister a trigger.
   */
  unregister(name) {
    const trigger = this._triggers.get(name);
    if (trigger) {
      // Clear any pending debounce
      if (trigger._debounceTimer) {
        clearTimeout(trigger._debounceTimer);
      }
    }

    // Remove event listener
    const unsub = this._listeners.get(name);
    if (typeof unsub === 'function') {
      unsub();
    }

    this._triggers.delete(name);
    this._listeners.delete(name);
  }

  /**
   * Enable/disable a trigger.
   */
  setEnabled(name, enabled) {
    const trigger = this._triggers.get(name);
    if (trigger) trigger.enabled = enabled;
  }

  /**
   * Enable/disable all triggers.
   */
  setAllEnabled(enabled) {
    this._config.enabled = enabled;
    for (const trigger of this._triggers.values()) {
      trigger.enabled = enabled;
    }
  }

  /**
   * Fire a trigger manually (bypasses event matching).
   */
  async fire(name, eventData = {}) {
    const trigger = this._triggers.get(name);
    if (!trigger) {
      logger.wuWarn(`[wu-ai] Trigger '${name}' not found`);
      return null;
    }
    return this._executeTrigger(trigger, eventData);
  }

  /**
   * Get registered trigger names.
   */
  getNames() {
    return [...this._triggers.keys()];
  }

  /**
   * Get trigger info.
   */
  getTrigger(name) {
    const t = this._triggers.get(name);
    if (!t) return null;
    return {
      name: t.name,
      pattern: t.pattern,
      priority: t.priority,
      namespace: t.namespace,
      enabled: t.enabled,
      fireCount: t._fireCount,
      lastFired: t._lastFired,
    };
  }

  /**
   * Destroy all triggers and clean up.
   */
  destroy() {
    for (const name of [...this._triggers.keys()]) {
      this.unregister(name);
    }
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    this._batchQueue = [];
  }

  // ── Private: Event Handling ──

  async _handleEvent(triggerName, eventData) {
    if (!this._config.enabled) return;

    const trigger = this._triggers.get(triggerName);
    if (!trigger || !trigger.enabled) return;

    // Check condition
    const conditionMet = await trigger.checkCondition(eventData);
    if (!conditionMet) {
      this._stats.totalSkipped++;
      return;
    }

    // Priority routing
    if (trigger.priority === 'high') {
      // High priority: fire immediately (with debounce)
      this._debouncedFire(trigger, eventData);
    } else if (trigger.priority === 'low') {
      // Low priority: batch
      this._batchQueue.push({ trigger, eventData });
      this._scheduleBatch();
    } else {
      // Medium: debounce
      this._debouncedFire(trigger, eventData);
    }
  }

  _debouncedFire(trigger, eventData) {
    // Store pending event (latest wins for debounce)
    trigger._pendingEvent = eventData;

    if (trigger._debounceTimer) {
      clearTimeout(trigger._debounceTimer);
    }

    if (trigger.debounceMs <= 0) {
      // No debounce
      this._executeTrigger(trigger, eventData);
      return;
    }

    trigger._debounceTimer = setTimeout(() => {
      trigger._debounceTimer = null;
      const pending = trigger._pendingEvent;
      trigger._pendingEvent = null;
      if (pending) {
        this._executeTrigger(trigger, pending);
      }
    }, trigger.debounceMs);
  }

  _scheduleBatch() {
    if (this._batchTimer) return;

    this._batchTimer = setTimeout(() => {
      this._batchTimer = null;
      this._processBatch();
    }, this._config.batchIntervalMs);
  }

  async _processBatch() {
    const batch = [...this._batchQueue];
    this._batchQueue = [];

    // Deduplicate: keep last event per trigger
    const byTrigger = new Map();
    for (const { trigger, eventData } of batch) {
      byTrigger.set(trigger.name, { trigger, eventData });
    }

    for (const { trigger, eventData } of byTrigger.values()) {
      await this._executeTrigger(trigger, eventData);
    }
  }

  async _executeTrigger(trigger, eventData) {
    try {
      const prompt = trigger.buildPrompt(eventData);
      if (!prompt) {
        this._stats.totalSkipped++;
        return null;
      }

      logger.wuDebug(`[wu-ai] Trigger '${trigger.name}' firing with prompt: ${prompt.slice(0, 100)}...`);

      const result = await this._conversation.send(prompt, {
        namespace: trigger.namespace,
        systemPrompt: trigger.systemPrompt,
        temperature: trigger.temperature,
        maxTokens: trigger.maxTokens,
      });

      trigger._fireCount++;
      trigger._lastFired = Date.now();
      this._stats.totalFired++;

      // Emit trigger result event
      this._eventBus.emit('ai:trigger:result', {
        trigger: trigger.name,
        pattern: trigger.pattern,
        result,
      }, { appName: 'wu-ai' });

      // Call onResult callback if provided
      if (trigger.onResult) {
        try {
          await trigger.onResult(result, eventData);
        } catch (err) {
          logger.wuDebug(`[wu-ai] Trigger '${trigger.name}' onResult error: ${err.message}`);
        }
      }

      return result;
    } catch (err) {
      this._stats.totalErrors++;
      logger.wuWarn(`[wu-ai] Trigger '${trigger.name}' error: ${err.message}`);

      this._eventBus.emit('ai:trigger:error', {
        trigger: trigger.name,
        error: err.message,
      }, { appName: 'wu-ai' });

      return null;
    }
  }

  getStats() {
    const triggers = {};
    for (const [name, t] of this._triggers) {
      triggers[name] = {
        pattern: t.pattern,
        priority: t.priority,
        enabled: t.enabled,
        fireCount: t._fireCount,
        lastFired: t._lastFired,
      };
    }
    return {
      ...this._stats,
      triggerCount: this._triggers.size,
      batchQueueSize: this._batchQueue.length,
      triggers,
    };
  }
}
