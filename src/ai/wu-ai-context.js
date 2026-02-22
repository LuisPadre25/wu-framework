/**
 * WU-AI-CONTEXT: Automatic context collector for LLMs
 *
 * Collects state from wu.store, wu.eventBus, and registered apps.
 * Builds a structured context object and system prompt for the LLM.
 *
 * Key design:
 * - ON-DEMAND collection (no polling, zero CPU idle)
 * - Token budget with priority (high > medium > low)
 * - Sensitive data redaction
 * - System prompt generation
 */

import { logger } from '../core/wu-logger.js';
import { redactSensitive, estimateTokens, truncateToTokenBudget } from './wu-ai-schema.js';

// ─── Context Source Config ───────────────────────────────────────
//
// store: { include: ['user.*', 'cart.*'], priority: 'high' }
// events: { include: ['cart:*', 'user:*'], lastN: 10, priority: 'medium' }
// custom: [{ key: 'appVersion', value: () => '1.0', priority: 'low' }]

export class WuAIContext {
  constructor({ store, eventBus, core }) {
    this._store = store;
    this._eventBus = eventBus;
    this._core = core;

    this._config = {
      budget: 4000,       // token budget
      charRatio: 4,       // chars per token estimate
      sources: {
        store: { include: [], priority: 'high' },
        events: { include: [], lastN: 10, priority: 'medium' },
        custom: [],
      },
    };

    this._collectors = new Map(); // name → { collector, priority }
    this._lastSnapshot = null;
  }

  /**
   * Configure context collection.
   */
  configure(config) {
    if (config.budget !== undefined) this._config.budget = config.budget;
    if (config.charRatio !== undefined) this._config.charRatio = config.charRatio;
    if (config.sources) {
      if (config.sources.store) Object.assign(this._config.sources.store, config.sources.store);
      if (config.sources.events) Object.assign(this._config.sources.events, config.sources.events);
      if (config.sources.custom) this._config.sources.custom = config.sources.custom;
    }
  }

  /**
   * Register a named context collector.
   *
   * @param {string} name - Collector name (e.g., 'dashboard', 'analytics')
   * @param {{ collector: Function, priority?: string }} config
   */
  register(name, config) {
    this._collectors.set(name, {
      collector: config.collector,
      priority: config.priority || 'medium',
    });
    logger.wuDebug(`[wu-ai] Context collector registered: '${name}' (${config.priority || 'medium'})`);
  }

  /**
   * Collect all context ON-DEMAND.
   * Called before sending a message to the LLM.
   *
   * @returns {object} Context snapshot
   */
  async collect() {
    const snapshot = {
      _timestamp: Date.now(),
      _mountedApps: this._getMountedApps(),
    };

    // Collect store sources
    const storeData = this._collectStore();
    if (storeData && Object.keys(storeData).length > 0) {
      snapshot._store = storeData;
    }

    // Collect recent events
    const events = this._collectEvents();
    if (events.length > 0) {
      snapshot._events = events;
    }

    // Collect custom sources
    for (const custom of this._config.sources.custom) {
      try {
        const value = typeof custom.value === 'function' ? await custom.value() : custom.value;
        snapshot[custom.key] = value;
      } catch (err) {
        logger.wuDebug(`[wu-ai] Custom collector '${custom.key}' failed: ${err.message}`);
      }
    }

    // Collect registered collectors
    for (const [name, config] of this._collectors) {
      try {
        const data = await config.collector();
        snapshot[name] = data;
      } catch (err) {
        logger.wuDebug(`[wu-ai] Collector '${name}' failed: ${err.message}`);
      }
    }

    this._lastSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Build a system prompt from the context for the LLM.
   *
   * @param {{ tools?: Array }} [options] - Available tools to include
   * @returns {string} System prompt
   */
  toSystemPrompt(options = {}) {
    const snapshot = this._lastSnapshot;
    if (!snapshot) return this._baseSystemPrompt(options);

    const parts = [];

    // Base instruction
    parts.push(
      'You are an AI assistant connected to a live web application via Wu Framework.',
      'You can observe application state and execute actions when appropriate.',
      ''
    );

    // Mounted apps (always included)
    if (snapshot._mountedApps?.length) {
      parts.push(`MOUNTED APPS: ${snapshot._mountedApps.join(', ')}`, '');
    }

    // Budget tracking
    const budget = this._config.budget;
    const charBudget = budget * this._config.charRatio;
    let usedChars = parts.join('\n').length;

    // Priority-based inclusion
    const prioritized = this._prioritizeSections(snapshot);

    for (const section of prioritized) {
      const sectionText = section.text;
      if (usedChars + sectionText.length > charBudget) {
        // Try to truncate if high priority
        if (section.priority === 'high') {
          const remaining = charBudget - usedChars;
          if (remaining > 100) {
            parts.push(sectionText.slice(0, remaining) + '\n...[truncated]');
            usedChars += remaining;
          }
        }
        continue; // skip if over budget
      }
      parts.push(sectionText);
      usedChars += sectionText.length;
    }

    // Tools (outside budget — LLM needs these)
    if (options.tools?.length) {
      parts.push('', 'AVAILABLE TOOLS:');
      for (const tool of options.tools) {
        parts.push(`- ${tool.name}: ${tool.description}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get the last collected snapshot.
   */
  getSnapshot() {
    return this._lastSnapshot;
  }

  /**
   * Get a simplified context object for template interpolation.
   */
  getInterpolationContext() {
    if (!this._lastSnapshot) return {};
    const { _timestamp, _mountedApps, _store, _events, ...custom } = this._lastSnapshot;
    return {
      apps: _mountedApps,
      store: _store,
      events: _events,
      ...custom,
    };
  }

  // ── Private: Data Collection ──

  _collectStore() {
    if (!this._store) return {};
    const { include } = this._config.sources.store;
    if (!include || include.length === 0) return {};

    const data = {};
    for (const path of include) {
      try {
        const value = this._store.get(path);
        if (value !== undefined) {
          data[path] = redactSensitive(value);
        }
      } catch {
        // Path doesn't exist, skip
      }
    }
    return data;
  }

  _collectEvents() {
    if (!this._eventBus) return [];
    const { include, lastN } = this._config.sources.events;
    if (!include || include.length === 0) return [];

    const history = this._eventBus.history || [];
    const matching = history.filter(event => {
      return include.some(pattern => this._matchPattern(event.name || event.event, pattern));
    });

    return matching.slice(-(lastN || 10)).map(e => ({
      event: e.name || e.event,
      data: redactSensitive(e.data),
      timestamp: e.timestamp,
    }));
  }

  _getMountedApps() {
    if (!this._core) return [];
    try {
      // WuCore exposes mounted as Map or getStats()
      if (this._core.mounted instanceof Map) {
        return [...this._core.mounted.keys()];
      }
      const stats = this._core.getStats?.();
      return stats?.apps || stats?.mounted || [];
    } catch {
      return [];
    }
  }

  // ── Private: Priority & Budget ──

  _prioritizeSections(snapshot) {
    const sections = [];
    const storePriority = this._config.sources.store.priority || 'high';
    const eventPriority = this._config.sources.events.priority || 'medium';

    // Store snapshot
    if (snapshot._store && Object.keys(snapshot._store).length > 0) {
      sections.push({
        priority: storePriority,
        text: `APPLICATION STATE:\n${JSON.stringify(snapshot._store, null, 2)}`,
      });
    }

    // Recent events
    if (snapshot._events?.length) {
      const eventLines = snapshot._events.map(e =>
        `  [${e.event}] ${JSON.stringify(e.data)}`
      ).join('\n');
      sections.push({
        priority: eventPriority,
        text: `RECENT EVENTS:\n${eventLines}`,
      });
    }

    // Custom collectors
    for (const [name, config] of this._collectors) {
      if (snapshot[name] !== undefined) {
        sections.push({
          priority: config.priority,
          text: `${name.toUpperCase()}:\n${JSON.stringify(snapshot[name], null, 2)}`,
        });
      }
    }

    // Custom sources
    for (const custom of this._config.sources.custom) {
      if (snapshot[custom.key] !== undefined) {
        sections.push({
          priority: custom.priority || 'low',
          text: `${custom.key}: ${JSON.stringify(snapshot[custom.key])}`,
        });
      }
    }

    // Sort: high → medium → low
    const order = { high: 0, medium: 1, low: 2 };
    sections.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));

    return sections;
  }

  _baseSystemPrompt(options = {}) {
    let prompt = 'You are an AI assistant connected to a web application via Wu Framework.';
    if (options.tools?.length) {
      prompt += '\n\nAVAILABLE TOOLS:\n' + options.tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    }
    return prompt;
  }

  // ── Pattern Matching (reuse wu-framework convention) ──

  _matchPattern(eventName, pattern) {
    if (!eventName || !pattern) return false;
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return eventName === pattern;

    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^:]*') + '$');
    return regex.test(eventName);
  }

  getStats() {
    return {
      budget: this._config.budget,
      collectors: [...this._collectors.keys()],
      storePaths: this._config.sources.store.include,
      eventPatterns: this._config.sources.events.include,
      lastCollected: this._lastSnapshot?._timestamp || null,
    };
  }
}
