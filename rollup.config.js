import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';

const pkg = { name: 'wu-framework', version: '1.1.8' };
const input = 'src/index.js';
const banner = `/*! ${pkg.name} v${pkg.version} | MIT License */`;

const isProduction = process.env.NODE_ENV === 'production';
const target = process.env.BUILD_TARGET || 'all';

// Shared plugins
const basePlugins = [
  resolve({ browser: true }),
  commonjs(),
  replace({
    preventAssignment: true,
    values: {
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
      __WU_VERSION__: JSON.stringify(pkg.version)
    }
  })
];

const minifyPlugin = terser({
  output: { comments: /^!/ }
});

// Build configurations
const configs = {
  // ESM - for bundlers (import/export)
  esm: {
    input,
    output: {
      file: 'dist/wu-framework.esm.js',
      format: 'es',
      banner,
      sourcemap: true
    },
    plugins: [...basePlugins, ...(isProduction ? [minifyPlugin] : [])]
  },

  // CJS - for Node.js (require)
  cjs: {
    input,
    output: {
      file: 'dist/wu-framework.cjs.js',
      format: 'cjs',
      banner,
      sourcemap: true,
      exports: 'named'
    },
    plugins: [...basePlugins, ...(isProduction ? [minifyPlugin] : [])]
  },

  // UMD - for browsers (<script> tag)
  umd: {
    input,
    output: {
      file: 'dist/wu-framework.umd.js',
      format: 'umd',
      name: 'WuFramework',
      banner,
      sourcemap: true,
      exports: 'named'
    },
    plugins: [...basePlugins, minifyPlugin]
  },

  // Dev - unminified ESM for debugging
  dev: {
    input,
    output: {
      file: 'dist/wu-framework.dev.js',
      format: 'es',
      banner,
      sourcemap: true
    },
    plugins: [...basePlugins]
  }
};

// Select which configs to build
function getConfigs() {
  if (target === 'all' || target === 'prod') {
    return [configs.esm, configs.cjs, configs.umd, configs.dev];
  }
  if (configs[target]) {
    return [configs[target]];
  }
  // Default: all
  return [configs.esm, configs.cjs, configs.umd, configs.dev];
}

export default getConfigs();
