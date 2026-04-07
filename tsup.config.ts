import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['react', 'react/jsx-runtime', '@solana/wallet-adapter-base', '@solana/web3.js'],
  esbuildOptions(options) {
    options.conditions = ['module'];
  },
});
