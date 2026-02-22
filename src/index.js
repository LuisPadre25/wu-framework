/**
 * WU-FRAMEWORK: UNIVERSAL MICROFRONTENDS
 *
 * Framework agnostic microfrontends with Shadow DOM isolation.
 * Supports React, Vue, Angular, Svelte, Solid, Preact, Lit, Vanilla.
 *
 * @example
 * import { wu, emit, on } from 'wu-framework';
 *
 * const canvas = wu.app('canvas', { url: 'http://localhost:5178', container: '#canvas' });
 * await canvas.mount();
 *
 * emit('user:login', { userId: 123 });
 * on('user:*', (e) => console.log(e.data));
 */

import { WuCore } from './core/wu-core.js';
import { WuAI } from './ai/wu-ai.js';

// --- Singleton: reuse host instance if it exists ---
let wu;

if (typeof window !== 'undefined' && window.wu && window.wu._isWuFramework) {
  wu = window.wu;
} else {
  wu = new WuCore();
  wu._isWuFramework = true;
}

// Expose globally for microfrontends
if (typeof window !== 'undefined') {
  window.wu = wu;

  if (!wu.version) {
    wu.version = '1.1.8';
    wu.info = {
      name: 'Wu Framework',
      description: 'Universal Microfrontends',
      features: ['Framework Agnostic', 'Zero Config', 'Shadow DOM Isolation', 'Runtime Loading']
    };
  }

  // Event Bus shortcuts on window.wu
  if (!wu.emit) {
    wu.emit = (event, data, opts) => wu.eventBus.emit(event, data, opts);
    wu.on = (event, cb) => wu.eventBus.on(event, cb);
    wu.once = (event, cb) => wu.eventBus.once(event, cb);
    wu.off = (event, cb) => wu.eventBus.off(event, cb);
  }

  // Prefetch shortcuts on window.wu
  if (!wu.prefetch) {
    wu.prefetch = (appNames, opts) => wu.prefetcher.prefetch(appNames, opts);
    wu.prefetchAll = (opts) => wu.prefetcher.prefetchAll(opts);
  }

  // Override shortcuts on window.wu
  if (!wu.override) {
    wu.override = (name, url, opts) => wu.overrides.set(name, url, opts);
    wu.removeOverride = (name) => wu.overrides.remove(name);
    wu.getOverrides = () => wu.overrides.getAll();
    wu.clearOverrides = () => wu.overrides.clearAll();
  }

  // Log control: window.wu.silence() / window.wu.verbose()
  if (!wu.silence) {
    wu.silence = async () => { const { silenceAllLogs } = await import('./core/wu-logger.js'); silenceAllLogs(); };
    wu.verbose = async () => { const { enableAllLogs } = await import('./core/wu-logger.js'); enableAllLogs(); };
  }

  // AI integration — lazy instantiated on first access
  if (!wu.ai) {
    let _aiInstance = null;
    Object.defineProperty(wu, 'ai', {
      get() {
        if (!_aiInstance) {
          _aiInstance = new WuAI({
            eventBus: wu.eventBus,
            store: wu.store,
            core: wu,
          });
        }
        return _aiInstance;
      },
      configurable: true,
    });
  }

  // MCP bridge — connects to wu-mcp-server for AI agent control
  if (!wu.mcp) {
    let _mcpBridge = null;
    wu.mcp = {
      async connect(url = 'ws://localhost:19100', options = {}) {
        if (!_mcpBridge) {
          const { createMcpBridge } = await import('./core/wu-mcp-bridge.js');
          _mcpBridge = createMcpBridge(wu);
        }
        _mcpBridge.connect(url, options);
      },
      disconnect() {
        _mcpBridge?.disconnect();
      },
      isConnected() {
        return _mcpBridge?.isConnected() || false;
      },
    };
  }
}

// --- Primary exports ---
export { wu };
export default wu;

// --- Core classes (advanced usage) ---
export { WuCore } from './core/wu-core.js';
export { WuLoader } from './core/wu-loader.js';
export { WuSandbox } from './core/wu-sandbox.js';
export { WuManifest } from './core/wu-manifest.js';
export { WuStore, default as store } from './core/wu-store.js';
export { WuApp } from './core/wu-app.js';
export { WuStyleBridge } from './core/wu-style-bridge.js';
export { WuCache } from './core/wu-cache.js';
export { WuEventBus } from './core/wu-event-bus.js';
export { WuPerformance } from './core/wu-performance.js';
export { WuProxySandbox } from './core/wu-proxy-sandbox.js';
export { WuSnapshotSandbox } from './core/wu-snapshot-sandbox.js';
export { WuHtmlParser } from './core/wu-html-parser.js';
export { WuScriptExecutor } from './core/wu-script-executor.js';
export { WuIframeSandbox } from './core/wu-iframe-sandbox.js';
export { WuPluginSystem, createPlugin } from './core/wu-plugin.js';
export { WuLoadingStrategy } from './core/wu-strategies.js';
export { WuPrefetch } from './core/wu-prefetch.js';
export { WuOverrides } from './core/wu-overrides.js';
export { WuErrorBoundary } from './core/wu-error-boundary.js';
export {
  WuLifecycleHooks,
  createSimpleHook,
  createConditionalHook,
  createGuardHook,
  createTransformHook,
  createTimedHook
} from './core/wu-hooks.js';
export { silenceAllLogs, enableAllLogs } from './core/wu-logger.js';

// --- Convenience API (most-used shortcuts) ---
export const init = (apps) => wu.init({ apps });
export const mount = (name, container) => wu.mount(name, container);
export const unmount = (name, opts) => wu.unmount(name, opts);
export const define = (name, lifecycle) => wu.define(name, lifecycle);
export const app = (name, config) => wu.app(name, config);
export const destroy = () => wu.destroy();

// Keep-alive
export const hide = (name) => wu.hide(name);
export const show = (name) => wu.show(name);
export const isHidden = (name) => wu.isHidden(name);

// Event Bus
export const emit = (event, data, opts) => wu.eventBus.emit(event, data, opts);
export const on = (event, cb) => wu.eventBus.on(event, cb);
export const once = (event, cb) => wu.eventBus.once(event, cb);
export const off = (event, cb) => wu.eventBus.off(event, cb);

// Store
export const getState = (path) => wu.store.get(path);
export const setState = (path, value) => wu.store.set(path, value);
export const onStateChange = (pattern, cb) => wu.store.on(pattern, cb);

// Performance
export const startMeasure = (name, app) => wu.performance.startMeasure(name, app);
export const endMeasure = (name, app) => wu.performance.endMeasure(name, app);
export const generatePerformanceReport = () => wu.performance.generateReport();

// Prefetch
export const prefetch = (appNames, opts) => wu.prefetch(appNames, opts);
export const prefetchAll = (opts) => wu.prefetchAll(opts);

// Overrides (QA/testing)
export const override = (name, url, opts) => wu.override(name, url, opts);
export const removeOverride = (name) => wu.removeOverride(name);
export const getOverrides = () => wu.getOverrides();
export const clearOverrides = () => wu.clearOverrides();

// Plugins & Hooks
export const usePlugin = (plugin, opts) => wu.pluginSystem.use(plugin, opts);
export const useHook = (phase, middleware, opts) => wu.hooks.use(phase, middleware, opts);

// --- AI classes (advanced usage) ---
export { WuAI } from './ai/wu-ai.js';
export { WuAIProvider } from './ai/wu-ai-provider.js';
export { WuAIPermissions } from './ai/wu-ai-permissions.js';
export { WuAIContext } from './ai/wu-ai-context.js';
export { WuAIActions } from './ai/wu-ai-actions.js';
export { WuAIConversation } from './ai/wu-ai-conversation.js';
export { WuAITriggers } from './ai/wu-ai-triggers.js';
export { WuAIAgent } from './ai/wu-ai-agent.js';
export { WuAIOrchestrate } from './ai/wu-ai-orchestrate.js';
export {
  sanitizeForPrompt,
  redactSensitive,
  interpolate,
  buildToolSchemas,
  normalizeParameters,
  validateParams,
  estimateTokens,
  truncateToTokenBudget,
} from './ai/wu-ai-schema.js';

// --- MCP Bridge (browser-side connection to wu-mcp-server) ---
export { createMcpBridge } from './core/wu-mcp-bridge.js';

// --- AI Browser Actions (autonomous agent control) ---
export { registerBrowserActions } from './ai/wu-ai-browser.js';

// --- AI Browser Primitives (shared browser automation functions) ---
export {
  ensureInterceptors,
  captureScreenshot,
  buildA11yTree,
  clickElement,
  typeIntoElement,
  getFilteredNetwork,
  getFilteredConsole,
} from './ai/wu-ai-browser-primitives.js';
