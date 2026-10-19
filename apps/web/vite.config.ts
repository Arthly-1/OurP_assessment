import { defineConfig } from 'vite';

const API_TARGET = process.env.API_URL ?? 'http://localhost:3000';
const apiRoutes = ['/process', '/info', '/health', '/docs', '/openapi.json'];

export default defineConfig({
  // In development the UI is served by Vite and calls the real API through a proxy, exactly as
  // a browser on the deployed origin would. There are no UI-only endpoints.
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      apiRoutes.map((route) => [route, { target: API_TARGET, changeOrigin: true }]),
    ),
  },
  build: { outDir: 'dist', sourcemap: true },
});
