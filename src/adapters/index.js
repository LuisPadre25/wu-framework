/**
 * 🚀 WU-FRAMEWORK ADAPTERS
 *
 * Adapters oficiales para integrar Wu Framework con frameworks populares.
 * Soporta: React, Vue, Angular, Svelte, Preact, Solid.js, Lit, Vanilla JS
 *
 * Cada adapter incluye integración AI (Paradigma C: IA como Director de Orquesta).
 *
 * @example
 * // Importar adapter específico
 * import { wuReact } from 'wu-framework/adapters/react';
 * import { wuVue } from 'wu-framework/adapters/vue';
 * import { wuAngular } from 'wu-framework/adapters/angular';
 * import { wuSvelte } from 'wu-framework/adapters/svelte';
 * import { wuPreact } from 'wu-framework/adapters/preact';
 * import { wuSolid } from 'wu-framework/adapters/solid';
 * import { wuLit } from 'wu-framework/adapters/lit';
 * import { wuVanilla } from 'wu-framework/adapters/vanilla';
 *
 * @example
 * // Importar todo
 * import {
 *   wuReact, wuVue, wuAngular, wuSvelte,
 *   wuPreact, wuSolid, wuLit, wuVanilla
 * } from 'wu-framework/adapters';
 */

// ============================================
// REACT ADAPTER
// ============================================
export {
  wuReact,
  register as registerReact,
  createWuSlot,
  createUseWuEvents,
  createUseWuStore,
  createUseWuAI
} from './react/index.js';

// ============================================
// VUE ADAPTER
// ============================================
export {
  wuVue,
  register as registerVue,
  WuSlot,
  useWuEvents,
  useWuStore,
  wuVuePlugin,
  createUseWuAI as createVueUseWuAI,
  useWuAI as useVueWuAI
} from './vue/index.js';

// ============================================
// ANGULAR ADAPTER
// ============================================
export {
  wuAngular,
  register as registerAngular,
  registerStandalone as registerAngularStandalone,
  createWuService,
  createWuSlotComponent,
  getWuSlotModuleConfig,
  createWuAIService
} from './angular/index.js';

// ============================================
// SVELTE ADAPTER
// ============================================
export {
  wuSvelte,
  register as registerSvelte,
  registerSvelte5,
  createWuStore as createSvelteWuStore,
  createWuEventStore,
  useWuEvents as useSvelteWuEvents,
  createWuSlotConfig,
  createWuAIStore
} from './svelte/index.js';

// ============================================
// PREACT ADAPTER
// ============================================
export {
  wuPreact,
  register as registerPreact,
  registerCompat as registerPreactCompat,
  createWuSlot as createPreactWuSlot,
  createUseWuEvents as createPreactUseWuEvents,
  createUseWuStore as createPreactUseWuStore,
  createUseWuAI as createPreactUseWuAI
} from './preact/index.js';

// ============================================
// SOLID.JS ADAPTER
// ============================================
export {
  wuSolid,
  register as registerSolid,
  createWuSlot as createSolidWuSlot,
  createWuStore as createSolidWuStore,
  createWuEvent,
  useWuEvents as useSolidWuEvents,
  createWuContext,
  createUseWuAI as createSolidUseWuAI
} from './solid/index.js';

// ============================================
// LIT (WEB COMPONENTS) ADAPTER
// ============================================
export {
  wuLit,
  register as registerLit,
  registerWebComponent,
  createWuSlotElement,
  WuMixin,
  WuAIMixin,
  wuProperty,
  createSimpleElement
} from './lit/index.js';

// ============================================
// VANILLA JS ADAPTER
// ============================================
export {
  wuVanilla,
  register as registerVanilla,
  registerClass,
  registerTemplate,
  createComponent,
  createWuSlot as createVanillaWuSlot,
  useWuEvents as useVanillaWuEvents,
  useWuStore as useVanillaWuStore,
  useWuAI as useVanillaWuAI
} from './vanilla/index.js';

// ============================================
// SHARED UTILITIES
// ============================================
export { getWuInstance, waitForWu } from './shared.js';

// ============================================
// ALL ADAPTERS OBJECT
// ============================================
import { wuReact } from './react/index.js';
import { wuVue } from './vue/index.js';
import { wuAngular } from './angular/index.js';
import { wuSvelte } from './svelte/index.js';
import { wuPreact } from './preact/index.js';
import { wuSolid } from './solid/index.js';
import { wuLit } from './lit/index.js';
import { wuVanilla } from './vanilla/index.js';

/**
 * Objeto con todos los adapters disponibles
 */
export const adapters = {
  react: wuReact,
  vue: wuVue,
  angular: wuAngular,
  svelte: wuSvelte,
  preact: wuPreact,
  solid: wuSolid,
  lit: wuLit,
  vanilla: wuVanilla
};

export default adapters;
