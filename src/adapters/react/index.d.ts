/**
 * Wu Framework React Adapter - TypeScript Definitions
 */

import { ComponentType, ReactElement, CSSProperties, RefObject } from 'react';

// ============================================================================
// Core Types
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
// React Adapter Types
// ============================================================================

export interface RegisterOptions {
  /** Wrap component in StrictMode (default: true) */
  strictMode?: boolean;
  /** Initial props for the component */
  props?: Record<string, any>;
  /** Callback after mounting */
  onMount?: (container: HTMLElement) => void;
  /** Callback before unmounting */
  onUnmount?: (container: HTMLElement) => void;
  /** Allow standalone execution (default: true) */
  standalone?: boolean;
  /** Selector for standalone mode (default: '#root') */
  standaloneContainer?: string;
}

/**
 * Register a React component as a microfrontend
 */
export function register<P = {}>(
  appName: string,
  Component: ComponentType<P>,
  options?: RegisterOptions
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
  /** Custom fallback while loading */
  fallback?: ReactElement | null;
  /** Callback when microfrontend loads successfully */
  onLoad?: (info: { name: string; url: string }) => void;
  /** Callback when loading fails */
  onError?: (error: Error) => void;
  /** Callback when microfrontend mounts */
  onMount?: (info: { name: string; container: HTMLElement }) => void;
  /** Callback when microfrontend unmounts */
  onUnmount?: (info: { name: string }) => void;
  /** Additional CSS class */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
}

/**
 * Create a WuSlot component for loading microfrontends
 * @param React - React instance
 */
export function createWuSlot(React: any): ComponentType<WuSlotProps>;

// ============================================================================
// Hooks Types
// ============================================================================

export interface UseWuEventsReturn {
  /** Emit an event to the event bus */
  emit: (event: string, data?: any, options?: EmitOptions) => void;
  /** Subscribe to an event */
  on: (event: string, callback: EventCallback) => () => void;
  /** Subscribe to an event once */
  once: (event: string, callback: EventCallback) => () => void;
}

/**
 * Create the useWuEvents hook
 * @param React - React instance
 */
export function createUseWuEvents(React: any): () => UseWuEventsReturn;

export interface UseWuStoreReturn<T = any> {
  /** Current state value (reactive) */
  state: T | null;
  /** Set a value in the store */
  setState: (path: string, value: any) => void;
  /** Get a value from the store */
  getState: (path?: string) => any;
}

/**
 * Create the useWuStore hook
 * @param React - React instance
 */
export function createUseWuStore(React: any): <T = any>(namespace?: string) => UseWuStoreReturn<T>;

// ============================================================================
// AI Hook Types (Paradigma C: IA como Director de Orquesta)
// ============================================================================

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'action';
  content: string;
  result?: any;
  timestamp: number;
}

export interface UseWuAIOptions {
  namespace?: string;
  onActionExecuted?: (data: { action: string; result: any }) => void;
}

export interface UseWuAIReturn {
  messages: AIMessage[];
  isStreaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  sendSync: (text: string) => Promise<any | null>;
  abort: () => void;
  clear: () => void;
}

/**
 * Create the useWuAI hook for AI integration
 * @param React - React instance
 */
export function createUseWuAI(React: any): (options?: UseWuAIOptions) => UseWuAIReturn;

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

export interface WuReactAdapter {
  register: typeof register;
  createWuSlot: typeof createWuSlot;
  createUseWuEvents: typeof createUseWuEvents;
  createUseWuStore: typeof createUseWuStore;
  createUseWuAI: typeof createUseWuAI;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuReact: WuReactAdapter;
export default wuReact;
