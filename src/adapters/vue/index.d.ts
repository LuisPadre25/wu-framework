/**
 * Wu Framework Vue Adapter - TypeScript Definitions
 */

import { App, Component, Ref, DefineComponent } from 'vue';

// ============================================================================
// Core Types (shared with React adapter)
// ============================================================================

export interface WuInstance {
  init: (config: WuConfig) => Promise<void>;
  mount: (appName: string, container: string) => Promise<void>;
  unmount: (appName: string) => Promise<void>;
  define: (appName: string, lifecycle: WuLifecycle) => void;
  app: (name: string, config: WuAppConfig) => WuApp;
  eventBus: WuEventBus;
  store: WuStore;
}

export interface WuConfig {
  apps: Array<{
    name: string;
    url: string;
    strategy?: 'lazy' | 'eager' | 'preload' | 'idle';
  }>;
}

export interface WuLifecycle {
  mount: (container: HTMLElement) => void | Promise<void>;
  unmount: (container?: HTMLElement) => void | Promise<void>;
}

export interface WuAppConfig {
  url: string;
  container: string;
  autoInit?: boolean;
}

export interface WuApp {
  mount: (container?: string) => Promise<void>;
  unmount: () => Promise<void>;
  remount: () => Promise<void>;
  reload: () => Promise<void>;
  destroy: () => Promise<void>;
  isMounted: boolean;
  info: WuAppInfo;
}

export interface WuAppInfo {
  name: string;
  url: string;
  mounted: boolean;
  status: 'stable' | 'refreshed' | 'unstable';
}

export interface WuEventBus {
  emit: (event: string, data?: any, options?: EmitOptions) => void;
  on: (event: string, callback: EventCallback) => () => void;
  once: (event: string, callback: EventCallback) => () => void;
  off: (event: string, callback?: EventCallback) => void;
}

export interface WuStore {
  get: (path?: string) => any;
  set: (path: string, value: any) => number;
  on: (pattern: string, callback: StoreCallback) => () => void;
  batch: (updates: Record<string, any>) => number[];
  clear: () => void;
}

export type EventCallback = (event: WuEvent) => void;
export type StoreCallback = (change: { path: string; value: any }) => void;

export interface WuEvent {
  name: string;
  data: any;
  timestamp: number;
  source?: string;
}

export interface EmitOptions {
  appName?: string;
  timestamp?: number;
  meta?: Record<string, any>;
}

// ============================================================================
// Vue Adapter Types
// ============================================================================

export interface VueRegisterOptions {
  /**
   * Function to configure the Vue app (install plugins, add global components, etc.)
   * @param app - Vue app instance
   */
  setup?: (app: App) => void;
  /** Initial props for the component */
  props?: Record<string, any>;
  /** Callback after mounting */
  onMount?: (container: HTMLElement, app: App) => void;
  /** Callback before unmounting */
  onUnmount?: (container: HTMLElement, app: App) => void;
  /** Allow standalone execution (default: true) */
  standalone?: boolean;
  /** Selector for standalone mode (default: '#app') */
  standaloneContainer?: string;
}

/**
 * Register a Vue component as a microfrontend
 *
 * @example
 * // Basic
 * wuVue.register('my-app', App);
 *
 * @example
 * // With plugins
 * wuVue.register('my-app', App, {
 *   setup: (app) => {
 *     app.use(createPinia());
 *     app.use(router);
 *   }
 * });
 */
export function register(
  appName: string,
  RootComponent: Component,
  options?: VueRegisterOptions
): Promise<boolean>;

// ============================================================================
// WuSlot Component Types
// ============================================================================

export interface WuSlotProps {
  /** Display name for the microfrontend */
  name: string;
  /** URL where the microfrontend is hosted */
  url: string;
  /** App name from wu.json (defaults to name if not provided) */
  appName?: string;
  /** Custom fallback text while loading */
  fallbackText?: string;
}

export interface WuSlotEmits {
  /** Emitted when microfrontend loads successfully */
  (e: 'load', info: { name: string; url: string }): void;
  /** Emitted when loading fails */
  (e: 'error', error: Error): void;
  /** Emitted when microfrontend mounts */
  (e: 'mount', info: { name: string; container: HTMLElement }): void;
  /** Emitted when microfrontend unmounts */
  (e: 'unmount', info: { name: string }): void;
}

/**
 * Vue component for loading microfrontends
 *
 * @example
 * <WuSlot name="my-app" url="http://localhost:3001" @load="onLoad" />
 */
export const WuSlot: DefineComponent<WuSlotProps, {}, {}, {}, {}, {}, {}, WuSlotEmits>;

// ============================================================================
// Composables Types
// ============================================================================

export interface UseWuEventsReturn {
  /** Emit an event to the event bus */
  emit: (event: string, data?: any, options?: EmitOptions) => void;
  /** Subscribe to an event */
  on: (event: string, callback: EventCallback) => () => void;
  /** Subscribe to an event once */
  once: (event: string, callback: EventCallback) => () => void;
  /** Unsubscribe from an event */
  off: (event: string, callback?: EventCallback) => void;
  /** Clean up all subscriptions (call in onUnmounted) */
  cleanup: () => void;
}

/**
 * Composable for using Wu Framework EventBus
 *
 * @example
 * const { emit, on, cleanup } = useWuEvents();
 *
 * onMounted(() => {
 *   on('user:login', handleLogin);
 * });
 *
 * onUnmounted(() => {
 *   cleanup();
 * });
 */
export function useWuEvents(): UseWuEventsReturn;

export interface UseWuStoreReturn<T = any> {
  /** Reactive state value */
  state: Ref<T | null>;
  /** Set a value in the store */
  setState: (path: string, value: any) => void;
  /** Get a value from the store */
  getState: (path?: string) => any;
  /** Clean up subscription (call in onUnmounted) */
  cleanup: () => void;
}

/**
 * Composable for using Wu Framework Store
 *
 * @example
 * const { state, setState, getState, cleanup } = useWuStore('user');
 *
 * // state.value is reactive
 * watchEffect(() => {
 *   console.log('User changed:', state.value);
 * });
 *
 * onUnmounted(() => {
 *   cleanup();
 * });
 */
export function useWuStore<T = any>(namespace?: string): UseWuStoreReturn<T>;

// ============================================================================
// Plugin Types
// ============================================================================

export interface WuVuePluginOptions {
  // Reserved for future options
}

/**
 * Vue plugin to install Wu Framework globally
 *
 * @example
 * import { createApp } from 'vue';
 * import { wuVuePlugin } from 'wu-framework/adapters/vue';
 *
 * const app = createApp(App);
 * app.use(wuVuePlugin);
 *
 * // Now you can use:
 * // - <WuSlot /> component globally
 * // - this.$wu in Options API
 * // - inject('wu') in Composition API
 */
export const wuVuePlugin: {
  install: (app: App, options?: WuVuePluginOptions) => void;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the Wu Framework instance
 */
export function getWuInstance(): WuInstance | null;

/**
 * Wait for Wu Framework to be available
 * @param timeout - Maximum time to wait in ms (default: 5000)
 */
export function waitForWu(timeout?: number): Promise<WuInstance>;

// ============================================================================
// Main Export
// ============================================================================

export interface WuVueAdapter {
  register: typeof register;
  WuSlot: typeof WuSlot;
  useWuEvents: typeof useWuEvents;
  useWuStore: typeof useWuStore;
  wuVuePlugin: typeof wuVuePlugin;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuVue: WuVueAdapter;
export default wuVue;

// ============================================================================
// Global Augmentations
// ============================================================================

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    /** Wu Framework instance */
    $wu: WuInstance | null;
    /** Wu Framework EventBus helpers */
    $wuEvents: UseWuEventsReturn;
    /** Wu Framework Store factory */
    $wuStore: <T = any>(namespace?: string) => UseWuStoreReturn<T>;
  }
}
