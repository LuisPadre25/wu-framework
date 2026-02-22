import type { AstroIntegration } from 'astro';

/** Configuration for a single wu micro-app. */
export interface WuAppConfig {
  /** Unique name used to reference this micro-app. */
  name: string;
  /** URL or path from which the micro-app is loaded. */
  url: string;
  /** Loading strategy. Defaults to the framework default. */
  strategy?: 'eager' | 'lazy' | 'manual';
}

/** Options accepted by the wu Astro integration. */
export interface WuIntegrationOptions {
  /** Micro-apps to auto-register via wu.init(). */
  apps?: WuAppConfig[];
  /** Global sandbox isolation mode. */
  sandbox?: 'module' | 'strict' | 'eval';
  /** CDN URL for the wu-framework UMD bundle. When omitted the local package is used. */
  cdn?: string;
  /** Enable debug logging. */
  debug?: boolean;
}

/**
 * Astro integration factory for wu-framework.
 *
 * @example
 * import wu from '@wu-framework/astro';
 * export default defineConfig({ integrations: [wu({ apps: [...] })] });
 */
export default function wuIntegration(
  options?: WuIntegrationOptions
): AstroIntegration;

/** Props for the WuShell.astro layout component. */
export interface WuShellProps {
  apps: WuAppConfig[];
  sandbox?: 'module' | 'strict' | 'eval';
  debug?: boolean;
}

/** Props for the WuApp.astro mount component. */
export interface WuAppProps {
  /** Name of the registered wu micro-app. */
  name: string;
  /** Defer mounting until the element is visible (IntersectionObserver). */
  lazy?: boolean;
  /** CSS class(es) for the container div. */
  class?: string;
  /** Inline styles for the container div. */
  style?: string;
}
