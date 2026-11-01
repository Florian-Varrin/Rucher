import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: { index: 'src/index.ts', mcp: 'src/mcp/index.ts' },
    dts: {
      generator: 'tsgo',
    },
    exports: { devExports: 'development' },
  },
});
