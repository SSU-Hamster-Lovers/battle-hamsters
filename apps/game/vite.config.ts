import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@battle-hamsters/shared': resolve(__dirname, '../../packages/shared/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
