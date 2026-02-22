/**
 * 🚀 WU-FRAMEWORK SOLID.JS ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

// Solid types (generics to avoid hard dependency)
type Component<P = {}> = (props: P) => any;
type Accessor<T> = () => T;
type Setter<T> = (value: T | ((prev: T) => T)) => T;

/**
 * Opciones de registro Solid
 */
export interface SolidRegisterOptions {
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
  fallback?: string;
  onLoad?: (data: { name: string; url: string }) => void;
  onError?: (error: Error) => void;
  class?: string;
  style?: Record<string, string | number>;
}

/**
 * Resultado de createWuStore
 */
export type WuStoreResult<T = any> = [
  Accessor<T>,
  (path: string, value: any) => void
];

/**
 * Helper de eventos Wu para Solid
 */
export interface UseWuEventsResult {
  emit: (event: string, data?: any, options?: any) => void;
  on: (event: string, callback: (data: any) => void) => () => void;
  once: (event: string, callback: (data: any) => void) => () => void;
  off: (event: string, callback: (data: any) => void) => void;
}

/**
 * Contexto de Wu
 */
export interface WuContextResult {
  WuProvider: Component<{ children?: any }>;
  useWu: () => WuCore | null;
  WuContext: any;
}

export function register(
  appName: string,
  Component: Component,
  options?: SolidRegisterOptions
): Promise<boolean>;

export function createWuSlot(): Component<WuSlotProps>;

export function createWuStore<T = any>(namespace?: string): WuStoreResult<T>;

export function createWuEvent<T = any>(eventPattern: string): Accessor<T | null>;

export function useWuEvents(): UseWuEventsResult;

export function createWuContext(): WuContextResult;

export function getWuInstance(): WuCore | null;

export function waitForWu(timeout?: number): Promise<WuCore>;

export interface WuSolidAdapter {
  register: typeof register;
  createWuSlot: typeof createWuSlot;
  createWuStore: typeof createWuStore;
  createWuEvent: typeof createWuEvent;
  useWuEvents: typeof useWuEvents;
  createWuContext: typeof createWuContext;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuSolid: WuSolidAdapter;
export default wuSolid;
