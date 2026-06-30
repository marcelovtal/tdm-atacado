import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'client',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'client/index.html'),
        planejamento: resolve(__dirname, 'client/planejamento.html'),
        dashboard: resolve(__dirname, 'client/dashboard.html'),
        login: resolve(__dirname, 'client/login.html'),
        admin: resolve(__dirname, 'client/admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
});
