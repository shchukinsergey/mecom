import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./server/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist-server',
    emptyOutDir: true,
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
    },
  },
});
