// Wu Framework - Type Declarations

// --- Core Types ---

export interface WuEvent {
  name: string;
  data: any;
  timestamp: number;
  appName: string;
  meta: Record<string, any>;
  verified: boolean;
}

export interface WuAppConfig {
  name: string;
  url: string;
  container?: string;
  keepAlive?: boolean;
  sandbox?: 'module' | 'strict' | 'eval';
  styleMode?: 'shared' | 'isolated' | 'fully-isolated';
}

export interface WuLifecycle {
  mount: (container: HTMLElement) => void | Promise<void>;
  unmount?: (container: HTMLElement) => void | Promise<void>;
}

export interface WuPlugin {
  name: string;
  permissions?: Array<'mount' | 'events' | 'store' | 'apps' | 'config' | 'unsafe'>;
  install?: (api: WuSandboxedApi, options?: any) => void;
  uninstall?: (api: WuSandboxedApi) => void;
  beforeInit?: (context: any) => void | Promise<void>;
  afterInit?: (context: any) => void | Promise<void>;
  beforeMount?: (context: any) => void | boolean | Promise<void | boolean>;
  afterMount?: (context: any) => void | Promise<void>;
  beforeUnmount?: (context: any) => void | Promise<void>;
  afterUnmount?: (context: any) => void | Promise<void>;
  onError?: (context: any) => void | Promise<void>;
  onDestroy?: (context: any) => void | Promise<void>;
}

export interface WuSandboxedApi {
  version: string;
  info: { name: string; description: string; features: string[] };
  getAppInfo(appName: string): { name: string; state: string; timestamp: number } | null;
  getMountedApps(): string[];
  getStats(): Record<string, any>;
  emit?(event: string, data: any): boolean;
  on?(event: string, cb: (event: WuEvent) => void): () => void;
  off?(event: string, cb: (event: WuEvent) => void): void;
  getState?(path: string): any;
  setState?(path: string, value: any): number;
  mount?(appName: string, container: string): Promise<void>;
  unmount?(appName: string): Promise<void>;
}

// --- Core Classes ---

export class WuCore {
  apps: Map<string, any>;
  mounted: Map<string, any>;
  eventBus: WuEventBus;
  store: WuStore;
  pluginSystem: WuPluginSystem;
  hooks: WuLifecycleHooks;
  performance: WuPerformance;

  init(config: { apps: WuAppConfig[]; sandbox?: string; overrides?: any }): Promise<void>;
  mount(appName: string, containerSelector: string): Promise<void>;
  unmount(appName: string, options?: { force?: boolean; defer?: boolean }): Promise<void>;
  define(appName: string, lifecycle: WuLifecycle): void;
  app(name: string, config: Partial<WuAppConfig>): WuApp;
  hide(appName: string): Promise<void>;
  show(appName: string): Promise<void>;
  isHidden(appName: string): boolean;
  destroy(): void;
  getStats(): Record<string, any>;
}

export class WuEventBus {
  constructor();
  emit(eventName: string, data?: any, options?: { appName?: string; token?: string; meta?: any }): boolean;
  on(eventName: string, callback: (event: WuEvent) => void): () => void;
  once(eventName: string, callback: (event: WuEvent) => void): () => void;
  off(eventName: string, callback: (event: WuEvent) => void): void;
  registerApp(appName: string, options?: { permissions?: string[]; token?: string }): string;
  unregisterApp(appName: string): void;
  replay(eventNameOrPattern: string, callback: (event: WuEvent) => void): void;
  enableStrictMode(): void;
  disableStrictMode(): void;
  removeAll(): void;
  getStats(): Record<string, any>;
  configure(config: Partial<Record<string, any>>): void;
}

export class WuStore {
  constructor(bufferSize?: number);
  get(path?: string): any;
  set(path: string, value: any): number;
  on(pattern: string, callback: (value: any, path?: string) => void): () => void;
  batch(updates: Record<string, any>): number[];
  clear(): void;
  getMetrics(): { reads: number; writes: number; notifications: number; bufferUtilization: number; listenerCount: number };
  getRecentEvents(count?: number): Array<{ path: string; value: any; timestamp: number }>;
}

export class WuLoader {
  constructor(options?: { maxCacheSize?: number; cacheTTL?: number });
  loadApp(appUrl: string, manifest?: any): Promise<string>;
  loadComponent(appUrl: string, componentPath: string): Promise<any>;
  preload(appConfigs: WuAppConfig[]): Promise<void>;
  isAvailable(url: string): Promise<boolean>;
  clearCache(pattern?: string): void;
  getStats(): Record<string, any>;
}

export class WuSandbox {
  create(appName: string, container: HTMLElement, options?: any): any;
}

export class WuManifest {
  load(appUrl: string): Promise<any>;
  validate(manifest: any): any;
  create(name: string, config?: any): any;
  clearCache(pattern?: string): void;
}

export class WuApp {
  mount(): Promise<void>;
  unmount(): Promise<void>;
}

export class WuCache {
  constructor(options?: { maxSize?: number; maxItems?: number; defaultTTL?: number; persistent?: boolean; storage?: string });
  get(key: string): any;
  set(key: string, value: any, ttl?: number): boolean;
  delete(key: string): void;
  clear(): void;
  getStats(): Record<string, any>;
}

export class WuPerformance {
  startMeasure(name: string, appName?: string): void;
  endMeasure(name: string, appName?: string): number;
  generateReport(): Record<string, any>;
}

export class WuProxySandbox {
  constructor(appName: string, options?: Record<string, any>);
  activate(): any;
  deactivate(): void;
  patchWindow(): void;
  unpatchWindow(): void;
  setContainer(container: HTMLElement, shadowRoot: ShadowRoot): void;
  getProxy(): any;
  isActive(): boolean;
  getStats(): Record<string, any>;
}

export class WuSnapshotSandbox {
  constructor(appName: string);
  activate(): void;
  deactivate(): void;
}

export class WuHtmlParser {
  parse(html: string, appName: string, baseUrl: string): { dom: string; scripts: { inline: string[]; external: string[] }; styles: { inline: string[]; external: string[] } };
  fetchHtml(url: string, appName: string): Promise<string>;
  fetchAndParse(url: string, appName: string): Promise<any>;
  clearCache(): void;
}

export class WuScriptExecutor {
  execute(scriptText: string, appName: string, proxy: any, options?: { strictGlobal?: boolean; sourceUrl?: string }): any;
  fetchScript(url: string): Promise<string>;
  executeAll(scripts: Array<{ content?: string; src?: string }>, appName: string, proxy: any, options?: any): Promise<void>;
}

export class WuIframeSandbox {
  constructor();
}

export class WuPluginSystem {
  constructor(core: WuCore, options?: { hookTimeout?: number });
  use(plugin: WuPlugin | ((options?: any) => WuPlugin), options?: any): void;
  uninstall(pluginName: string): void;
  getPlugin(pluginName: string): WuPlugin | undefined;
  getStats(): Record<string, any>;
  cleanup(): void;
}

export class WuLoadingStrategy {
  constructor(core: WuCore);
}

export class WuPrefetch {
  constructor(core: WuCore);
  prefetch(appNames: string | string[], options?: any): Promise<void>;
  prefetchAll(options?: any): Promise<void>;
}

export class WuOverrides {
  constructor();
  set(name: string, url: string, options?: any): void;
  remove(name: string): void;
  getAll(): Record<string, string>;
  clearAll(): void;
}

export class WuErrorBoundary {
  constructor(core: WuCore);
  handle(error: Error, context?: any): Promise<{ recovered: boolean; action: string; message?: string }>;
  register(handler: { name: string; canHandle: (error: Error) => boolean; handle: (error: Error, context: any) => Promise<any> }): void;
  getErrorLog(limit?: number): any[];
  getStats(): Record<string, any>;
}

export class WuLifecycleHooks {
  constructor(core: WuCore);
  use(phase: string, middleware: Function, options?: any): void;
  execute(phase: string, context?: any): Promise<{ cancelled: boolean }>;
}

export class WuStyleBridge {}

// --- Hook Factories ---

export function createSimpleHook(fn: Function): any;
export function createConditionalHook(condition: Function, fn: Function): any;
export function createGuardHook(fn: Function): any;
export function createTransformHook(fn: Function): any;
export function createTimedHook(fn: Function, timeout: number): any;
export function createPlugin(config: WuPlugin): WuPlugin;

// --- Convenience API ---

export const wu: WuCore;
export default wu;

export function init(apps: WuAppConfig[]): Promise<void>;
export function mount(name: string, container: string): Promise<void>;
export function unmount(name: string, opts?: any): Promise<void>;
export function define(name: string, lifecycle: WuLifecycle): void;
export function app(name: string, config: Partial<WuAppConfig>): WuApp;
export function destroy(): void;
export function hide(name: string): Promise<void>;
export function show(name: string): Promise<void>;
export function isHidden(name: string): boolean;

export function emit(event: string, data?: any, opts?: any): boolean;
export function on(event: string, cb: (event: WuEvent) => void): () => void;
export function once(event: string, cb: (event: WuEvent) => void): () => void;
export function off(event: string, cb: (event: WuEvent) => void): void;

export function getState(path?: string): any;
export function setState(path: string, value: any): number;
export function onStateChange(pattern: string, cb: (value: any) => void): () => void;

export function startMeasure(name: string, app?: string): void;
export function endMeasure(name: string, app?: string): number;
export function generatePerformanceReport(): Record<string, any>;

export function prefetch(appNames: string | string[], opts?: any): Promise<void>;
export function prefetchAll(opts?: any): Promise<void>;

export function override(name: string, url: string, opts?: any): void;
export function removeOverride(name: string): void;
export function getOverrides(): Record<string, string>;
export function clearOverrides(): void;

export function usePlugin(plugin: WuPlugin | Function, opts?: any): void;
export function useHook(phase: string, middleware: Function, opts?: any): void;

export function silenceAllLogs(): void;
export function enableAllLogs(): void;

// --- AI Classes ---

export class WuAI {
  provider(name: string, config: any): void;
  send(message: string, options?: any): Promise<any>;
  stream(message: string, options?: any): AsyncGenerator<any>;
  json(message: string, options?: any): Promise<any>;
  action(name: string, config: any): void;
  agent(goal: string, options?: any): Promise<any>;
}

export class WuAIProvider {}
export class WuAIPermissions {}
export class WuAIContext {}
export class WuAIActions {}
export class WuAIConversation {}
export class WuAITriggers {}
export class WuAIAgent {}
export class WuAIOrchestrate {}

export function sanitizeForPrompt(text: string): string;
export function redactSensitive(text: string): string;
export function interpolate(template: string, vars: Record<string, any>): string;
export function buildToolSchemas(actions: any): any;
export function normalizeParameters(params: any): any;
export function validateParams(params: any, schema: any): boolean;
export function estimateTokens(text: string): number;
export function truncateToTokenBudget(text: string, budget: number): string;

// --- MCP & Browser ---

export function createMcpBridge(core: WuCore): any;
export function registerBrowserActions(ai: WuAI): void;
export function ensureInterceptors(): void;
export function captureScreenshot(): Promise<string>;
export function buildA11yTree(): any;
export function clickElement(selector: string): Promise<void>;
export function typeIntoElement(selector: string, text: string): Promise<void>;
export function getFilteredNetwork(): any[];
export function getFilteredConsole(): any[];
