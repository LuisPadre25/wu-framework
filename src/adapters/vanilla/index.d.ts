/**
 * 🚀 WU-FRAMEWORK VANILLA JS ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

/**
 * Configuración de app Vanilla
 */
export interface VanillaAppConfig {
  /** Función para renderizar */
  render: (container: HTMLElement, state?: any) => void;
  /** Función para limpiar (opcional) */
  destroy?: (container: HTMLElement, state?: any) => void;
  /** Función de inicialización (opcional) */
  init?: (container: HTMLElement, state?: any) => void;
  /** Estado inicial */
  state?: Record<string, any>;
}

/**
 * Opciones de registro Vanilla
 */
export interface VanillaRegisterOptions {
  /** Callback después de montar */
  onMount?: (container: HTMLElement, state: any) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, state: any) => void;
  /** Permitir ejecución standalone */
  standalone?: boolean;
  /** Selector para modo standalone */
  standaloneContainer?: string;
}

/**
 * Opciones para registrar clase
 */
export interface VanillaClassOptions {
  /** Argumentos para el constructor */
  constructorArgs?: any[];
  /** Callback después de montar */
  onMount?: (container: HTMLElement, instance: any) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, instance: any) => void;
  /** Permitir ejecución standalone */
  standalone?: boolean;
  /** Selector para modo standalone */
  standaloneContainer?: string;
}

/**
 * Opciones para registrar template
 */
export interface VanillaTemplateOptions {
  /** Datos para el template */
  data?: Record<string, any>;
  /** Scripts a ejecutar */
  scripts?: Array<(container: HTMLElement, data: any) => void>;
  /** Estilos CSS */
  styles?: string[];
  /** Callback después de montar */
  onMount?: (container: HTMLElement, data: any) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, data: any) => void;
  /** Permitir ejecución standalone */
  standalone?: boolean;
  /** Selector para modo standalone */
  standaloneContainer?: string;
}

/**
 * Configuración de componente reactivo
 */
export interface ReactiveComponentConfig {
  /** Estado inicial */
  state?: Record<string, any>;
  /** Función template */
  template: (state: any) => string;
  /** Acciones que modifican estado */
  actions?: Record<string, (state: any, element?: HTMLElement) => any>;
  /** Callback en init */
  onInit?: (container: HTMLElement, state: any) => void;
  /** Callback en destroy */
  onDestroy?: (container: HTMLElement, state: any) => void;
}

/**
 * Componente reactivo creado
 */
export interface ReactiveComponent {
  state: any;
  init: (container: HTMLElement) => void;
  render: (container: HTMLElement, state?: any) => void;
  destroy: (container: HTMLElement) => void;
  setState: (newState: Partial<any>) => void;
  getState: () => any;
}

/**
 * Helper de eventos Wu
 */
export interface WuEventsHelper {
  emit: (event: string, data?: any, options?: any) => void;
  on: (event: string, callback: (data: any) => void) => () => void;
  once: (event: string, callback: (data: any) => void) => () => void;
  off: (event: string, callback: (data: any) => void) => void;
  cleanup: () => void;
}

/**
 * Helper de store Wu
 */
export interface WuStoreHelper {
  get: (path?: string) => any;
  set: (path: string, value: any) => void;
  onChange: (pattern: string, callback: (value: any) => void) => () => void;
}

/**
 * Instancia de WuSlot
 */
export interface WuSlotInstance {
  container: HTMLElement;
  destroy: () => Promise<void>;
}

export function register(
  appName: string,
  config: VanillaAppConfig,
  options?: VanillaRegisterOptions
): Promise<boolean>;

export function registerClass(
  appName: string,
  AppClass: new (container: HTMLElement, ...args: any[]) => any,
  options?: VanillaClassOptions
): Promise<boolean>;

export function registerTemplate(
  appName: string,
  template: string | ((data: any) => string),
  options?: VanillaTemplateOptions
): Promise<boolean>;

export function createComponent(config: ReactiveComponentConfig): ReactiveComponent;

export function createWuSlot(
  target: HTMLElement,
  props: {
    name: string;
    url: string;
    fallbackText?: string;
    onLoad?: (data: { name: string; url: string }) => void;
    onError?: (error: Error) => void;
  }
): WuSlotInstance;

export function useWuEvents(): WuEventsHelper;

export function useWuStore(namespace?: string): WuStoreHelper;

export function getWuInstance(): WuCore | null;

export function waitForWu(timeout?: number): Promise<WuCore>;

export interface WuVanillaAdapter {
  register: typeof register;
  registerClass: typeof registerClass;
  registerTemplate: typeof registerTemplate;
  createComponent: typeof createComponent;
  createWuSlot: typeof createWuSlot;
  useWuEvents: typeof useWuEvents;
  useWuStore: typeof useWuStore;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuVanilla: WuVanillaAdapter;
export default wuVanilla;
