import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // external registerSW.js: no inline script (CSP)
      includeAssets: ['robots.txt', 'icons/icon.svg'],
      manifest: {
        // Neutral name and icon that do not reveal the app's nature (Section 4.8).
        name: 'Nights',
        short_name: 'Nights',
        description: 'Nights',
        theme_color: '#0B0710',
        background_color: '#0B0710',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline shell = static assets only; the game itself needs a connection.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,txt}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io/, /^\/healthz/],
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/healthz': { target: API },
      '/socket.io': { target: API, ws: true },
    },
  },
});
