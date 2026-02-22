/**
 * 🚀 WU-FRAMEWORK ANGULAR ADAPTER - TypeScript Declarations
 */

import type { WuCore } from '../core/wu-core';

// Angular types (generics to avoid hard dependency)
type NgModuleRef<T> = any;
type ApplicationRef = any;
type Type<T> = new (...args: any[]) => T;
type ApplicationConfig = any;

/**
 * Opciones para registrar un módulo Angular
 */
export interface AngularRegisterOptions {
  /** Factory del platform (platformBrowserDynamic) */
  platformFactory?: () => any;
  /** Providers adicionales para bootstrap */
  providers?: any[];
  /** Callback después de montar */
  onMount?: (container: HTMLElement, moduleRef: NgModuleRef<any>) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, moduleRef: NgModuleRef<any>) => void;
  /** Permitir ejecución standalone (default: true) */
  standalone?: boolean;
  /** Selector para modo standalone (default: '#root') */
  standaloneContainer?: string;
  /** Selector del componente root (default: 'app-root') */
  rootSelector?: string;
}

/**
 * Opciones para registrar un componente standalone Angular
 */
export interface AngularStandaloneOptions {
  /** Configuración de la aplicación */
  appConfig?: ApplicationConfig;
  /** Callback después de montar */
  onMount?: (container: HTMLElement, appRef: ApplicationRef) => void;
  /** Callback antes de desmontar */
  onUnmount?: (container: HTMLElement, appRef: ApplicationRef) => void;
  /** Permitir ejecución standalone (default: true) */
  standalone?: boolean;
  /** Selector para modo standalone (default: '#root') */
  standaloneContainer?: string;
}

/**
 * Servicio de Wu Framework para Angular
 */
export interface WuService {
  /** Emitir evento */
  emit: (event: string, data?: any, options?: any) => void;
  /** Suscribirse a evento */
  on: (event: string, callback: (data: any) => void) => () => void;
  /** Suscribirse a evento una vez */
  once: (event: string, callback: (data: any) => void) => () => void;
  /** Desuscribirse de evento */
  off: (event: string, callback: (data: any) => void) => void;
  /** Obtener estado */
  getState: (path?: string) => any;
  /** Establecer estado */
  setState: (path: string, value: any) => void;
  /** Suscribirse a cambios de estado */
  onStateChange: (pattern: string, callback: (value: any) => void) => () => void;
  /** Destruir servicio y limpiar suscripciones */
  destroy: () => void;
  /** Acceso a instancia de Wu */
  readonly wu: WuCore | null;
}

/**
 * Configuración del componente WuSlot
 */
export interface WuSlotComponentConfig {
  selector: string;
  template: string;
  styles: string[];
  methods: {
    ngOnInit: () => Promise<void>;
    ngOnDestroy: () => void;
    mountMicrofrontend: () => Promise<void>;
    unmountMicrofrontend: () => Promise<void>;
  };
}

/**
 * Configuración del módulo WuSlot
 */
export interface WuSlotModuleConfig {
  imports: string[];
  declarations: string[];
  exports: string[];
}

/**
 * Registra un módulo Angular como microfrontend
 */
export function register(
  appName: string,
  AppModule: Type<any>,
  options?: AngularRegisterOptions
): Promise<boolean>;

/**
 * Registra un componente standalone Angular como microfrontend (Angular 14+)
 */
export function registerStandalone(
  appName: string,
  RootComponent: Type<any>,
  options?: AngularStandaloneOptions
): Promise<boolean>;

/**
 * Crea un servicio Wu para usar en Angular
 */
export function createWuService(): WuService;

/**
 * Crea la configuración para un componente WuSlot
 */
export function createWuSlotComponent(): WuSlotComponentConfig;

/**
 * Obtiene la configuración del módulo WuSlot
 */
export function getWuSlotModuleConfig(): WuSlotModuleConfig;

/**
 * Obtiene la instancia de Wu Framework
 */
export function getWuInstance(): WuCore | null;

/**
 * Espera a que Wu Framework esté disponible
 */
export function waitForWu(timeout?: number): Promise<WuCore>;

/**
 * API del adapter Angular
 */
export interface WuAngularAdapter {
  register: typeof register;
  registerStandalone: typeof registerStandalone;
  createWuService: typeof createWuService;
  createWuSlotComponent: typeof createWuSlotComponent;
  getWuSlotModuleConfig: typeof getWuSlotModuleConfig;
  getWuInstance: typeof getWuInstance;
  waitForWu: typeof waitForWu;
}

export const wuAngular: WuAngularAdapter;
export default wuAngular;
