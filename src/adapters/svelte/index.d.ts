/**
 * 🚀 WU-FRAMEWORK SVELTE ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

// Svelte types (generics to avoid hard dependency)
type SvelteComponent = any;
type ComponentConstructor<T = any> = new (options: any) => T;

/**
 * Opciones para registrar un componente Svelte
 */
export interface SvelteRegisterOptions {
  /** Props iniciales para el componente */
  props?: Record<string, any>;
  /** Contexto a pasar al componente */
  context?: Map<any, any>;
  /** Ejecutar transiciones de intro (default: false) */
  intro?: boolean;
  /** Callback después de montar */
  onMount?: (container: HTMLElement, instance: SvelteComponent) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, instance: SvelteComponent) => void;
  /** Permitir ejecución standalone (default: true) */
  standalone?: boolean;
  /** Selector para modo standalone (default: '#app') */
  standaloneContainer?: string;
}

/**
 * Opciones para registrar un componente Svelte 5
 */
export interface Svelte5RegisterOptions {
  /** Props iniciales para el componente */
  props?: Record<string, any>;
  /** Callback después de montar */
  onMount?: (container: HTMLElement, instance: any) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, instance: any) => void;
  /** Permitir ejecución standalone (default: true) */
  standalone?: boolean;
  /** Selector para modo standalone (default: '#app') */
  standaloneContainer?: string;
}

/**
 * Store de Wu compatible con Svelte
 */
export interface WuSvelteStore<T = any> {
  /** Suscribirse al store (Svelte store contract) */
  subscribe: (fn: (value: T) => void) => () => void;
  /** Establecer valor en path específico */
  set: (path: string, value: any) => void;
  /** Obtener valor de path específico */
  get: (path?: string) => any;
  /** Actualizar valor con función */
  update: (fn: (value: T) => T) => void;
}

/**
 * Store de eventos de Wu para Svelte
 */
export interface WuEventStore<T = any> {
  /** Suscribirse al store (Svelte store contract) */
  subscribe: (fn: (value: T | null) => void) => () => void;
  /** Emitir evento */
  emit: (data: any, options?: any) => void;
}

/**
 * Helper de eventos para Svelte
 */
export interface WuEventsHelper {
  /** Emitir evento */
  emit: (event: string, data?: any, options?: any) => void;
  /** Suscribirse a evento */
  on: (event: string, callback: (data: any) => void) => () => void;
  /** Suscribirse a evento una vez */
  once: (event: string, callback: (data: any) => void) => () => void;
  /** Desuscribirse de evento */
  off: (event: string, callback: (data: any) => void) => void;
  /** Limpiar todas las suscripciones */
  cleanup: () => void;
}

/**
 * Configuración del componente WuSlot para Svelte
 */
export interface WuSlotConfig {
  props: string[];
  template: string;
  createInstance: (target: HTMLElement, props: {
    name: string;
    url: string;
    appName?: string;
    fallbackText?: string;
    onLoad?: (data: { name: string; url: string }) => void;
    onError?: (error: Error) => void;
  }) => { destroy: () => Promise<void> };
}

/**
 * Registra un componente Svelte como microfrontend
 */
export function register(
  appName: string,
  Component: ComponentConstructor,
  options?: SvelteRegisterOptions
): Promise<boolean>;

/**
 * Registra un componente Svelte 5 como microfrontend
 */
export function registerSvelte5(
  appName: string,
  Component: ComponentConstructor,
  options?: Svelte5RegisterOptions
): Promise<boolean>;

/**
 * Crea un store de Wu compatible con Svelte
 */
export function createWuStore<T = any>(namespace?: string): WuSvelteStore<T>;

/**
 * Crea un store de eventos de Wu para Svelte
 */
export function createWuEventStore<T = any>(eventPattern: string): WuEventStore<T>;

/**
 * Helper para usar eventos de Wu en Svelte
 */
export function useWuEvents(): WuEventsHelper;

/**
 * Crea la configuración para un componente WuSlot
 */
export function createWuSlotConfig(): WuSlotConfig;

/**
 * Obtiene la instancia de Wu Framework
 */
export function getWuInstance(): WuCore | null;

/**
 * Espera a que Wu Framework esté disponible
 */
export function waitForWu(timeout?: number): Promise<WuCore>;

/**
 * API del adapter Svelte
 */
export interface WuSvelteAdapter {
  register: typeof register;
  registerSvelte5: typeof registerSvelte5;
  createWuStore: typeof createWuStore;
  createWuEventStore: typeof createWuEventStore;
  useWuEvents: typeof useWuEvents;
  createWuSlotConfig: typeof createWuSlotConfig;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuSvelte: WuSvelteAdapter;
export default wuSvelte;
