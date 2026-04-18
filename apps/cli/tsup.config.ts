import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
  target: 'node20',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
  tsconfig: 'tsconfig.build.json',
});
