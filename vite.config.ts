import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('web'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': path.resolve('shared') } },
  build: { outDir: path.resolve('dist'), emptyOutDir: true },
});
