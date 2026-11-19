import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false, // dist/public holds the copied web build
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep npm deps external.
  noExternal: ['@nc/shared'],
});
