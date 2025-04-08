import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  // ESM build
  {
    input: 'src/index.js',
    output: {
      dir: 'dist/esm',
      format: 'esm',
      preserveModules: true,
      preserveModulesRoot: 'src'
    },
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      commonjs({ transformMixedEsModules: true }),
      terser()
    ],
    external: ['cheerio', 'node-fetch']
  },
  // CommonJS build
  {
    input: 'src/index.js',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name]-[hash].cjs',
      preserveModules: true,
      preserveModulesRoot: 'src',
      exports: 'named'
    },
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      commonjs({ transformMixedEsModules: true }),
      terser()
    ],
    external: ['cheerio', 'node-fetch']
  }
];
