import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-webview',
    rollupOptions: {
      input: 'index-webview.html'
    }
  }
});
