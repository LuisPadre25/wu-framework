/**
 * 🚀 WU-FRAMEWORK LIT ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

// Lit types (generics to avoid hard dependency)
type LitElement = any;
type TemplateResult = any;

/**
 * Opciones de registro Lit
 */
export interface LitRegisterOptions {
  /** Nombre del custom element (auto-generado si no se provee) */
  tagName?: string;
  /** Propiedades iniciales */
  properties?: Record<string, any>;
  /** Callback después de montar */
  onMount?: (container: HTMLElement, element: HTMLElement) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, element: HTMLElement) => void;
  /** Permitir ejecución standalone */
  standalone?: boolean;
  /** Selector para modo standalone */
  standaloneContainer?: string;
}

/**
 * Configuración para crear elemento simple
 */
export interface SimpleElementConfig {
  /** Nombre del custom element */
  name: string;
  /** Template HTML */
  template: string | ((element: HTMLElement) => string);
  /** Estilos CSS */
  styles?: string;
  /** Usar Shadow DOM */
  shadow?: boolean;
  /** Atributos observados */
  observedAttributes?: string[];
  /** Callback cuando se conecta */
  connectedCallback?: (this: HTMLElement) => void;
  /** Callback cuando se desconecta */
  disconnectedCallback?: (this: HTMLElement) => void;
  /** Callback cuando cambia un atributo */
  attributeChangedCallback?: (this: HTMLElement, name: string, oldVal: string, newVal: string) => void;
}

/**
 * Clase WuSlot Element
 */
export interface WuSlotElementClass {
  new(): HTMLElement & {
    name: string;
    url: string;
    appName: string | null;
    fallbackText: string | null;
    loading: boolean;
    error: string | null;
  };
}

/**
 * Tipo para el Mixin de Wu
 */
export type WuMixinResult<T extends new (...args: any[]) => any> = T & {
  new (...args: any[]): InstanceType<T> & {
    readonly wu: WuCore | null;
    wuEmit(event: string, data?: any, options?: any): void;
    wuOn(event: string, callback: (data: any) => void): () => void;
    wuOnce(event: string, callback: (data: any) => void): () => void;
    wuGetState(path?: string): any;
    wuSetState(path: string, value: any): void;
    wuOnStateChange(pattern: string, callback: (value: any) => void): () => void;
  };
};

export function register(
  appName: string,
  ElementClass: CustomElementConstructor,
  options?: LitRegisterOptions
): Promise<boolean>;

export function registerWebComponent(
  appName: string,
  ElementClass: CustomElementConstructor,
  options?: LitRegisterOptions
): Promise<boolean>;

export function createWuSlotElement(
  LitElement: any,
  html: (strings: TemplateStringsArray, ...values: any[]) => TemplateResult,
  css?: (strings: TemplateStringsArray, ...values: any[]) => any
): WuSlotElementClass;

export function WuMixin<T extends new (...args: any[]) => any>(Base: T): WuMixinResult<T>;

export function wuProperty(storePath: string): PropertyDecorator;

export function createSimpleElement(config: SimpleElementConfig): CustomElementConstructor;

export function getWuInstance(): WuCore | null;

export function waitForWu(timeout?: number): Promise<WuCore>;

export interface WuLitAdapter {
  register: typeof register;
  registerWebComponent: typeof registerWebComponent;
  createWuSlotElement: typeof createWuSlotElement;
  WuMixin: typeof WuMixin;
  wuProperty: typeof wuProperty;
  createSimpleElement: typeof createSimpleElement;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuLit: WuLitAdapter;
export default wuLit;
