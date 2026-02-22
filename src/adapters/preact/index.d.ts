/**
 * 🚀 WU-FRAMEWORK PREACT ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

// Preact types (generics to avoid hard dependency)
type ComponentType<P = {}> = (props: P) => any;
type VNode = any;

/**
 * Opciones de registro Preact
 */
export interface PreactRegisterOptions {
  /** Props iniciales */
  props?: Record<string, any>;
  /** Callback después de montar */
  onMount?: (container: HTMLElement) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement) => void;
  /** Permitir ejecución standalone */
  standalone?: boolean;
  /** Selector para modo standalone */
  standaloneContainer?: string;
}

/**
 * Props del componente WuSlot
 */
export interface WuSlotProps {
  name: string;
  url: string;
  appName?: string;
  fallback?: VNode;
  onLoad?: (data: { name: string; url: string }) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: Record<string, string | number>;
}

/**
 * Hooks de Preact necesarios para createUseWuEvents
 */
export interface PreactHooks {
  useCallback: <T extends (...args: any[]) => any>(callback: T, deps: any[]) => T;
  useEffect: (effect: () => void | (() => void), deps?: any[]) => void;
  useRef: <T>(initialValue: T) => { current: T };
}

/**
 * Hooks para createUseWuStore
 */
export interface PreactStoreHooks extends PreactHooks {
  useState: <T>(initialValue: T | (() => T)) => [T, (value: T) => void];
}

/**
 * Helper de eventos Wu para Preact
 */
export interface UseWuEventsResult {
  emit: (event: string, data?: any, options?: any) => void;
  on: (event: string, callback: (data: any) => void) => () => void;
  once: (event: string, callback: (data: any) => void) => () => void;
}

/**
 * Helper de store Wu para Preact
 */
export interface UseWuStoreResult {
  state: any;
  setState: (path: string, value: any) => void;
  getState: (path?: string) => any;
}

export function register(
  appName: string,
  Component: ComponentType,
  options?: PreactRegisterOptions
): Promise<boolean>;

export function registerCompat(
  appName: string,
  Component: ComponentType,
  options?: PreactRegisterOptions
): Promise<boolean>;

export function createWuSlot(h: (type: any, props: any, ...children: any[]) => VNode): ComponentType<WuSlotProps>;

export function createUseWuEvents(hooks: PreactHooks): () => UseWuEventsResult;

export function createUseWuStore(hooks: PreactStoreHooks): (namespace?: string) => UseWuStoreResult;

export function getWuInstance(): WuCore | null;

export function waitForWu(timeout?: number): Promise<WuCore>;

export interface WuPreactAdapter {
  register: typeof register;
  registerCompat: typeof registerCompat;
  createWuSlot: typeof createWuSlot;
  createUseWuEvents: typeof createUseWuEvents;
  createUseWuStore: typeof createUseWuStore;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuPreact: WuPreactAdapter;
export default wuPreact;
