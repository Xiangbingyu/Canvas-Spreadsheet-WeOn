import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const API_PROXY_TARGET = 'http://127.0.0.1:3000'
const WS_PROXY_TARGET = 'ws://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/health': { target: API_PROXY_TARGET },
      '/docs': { target: API_PROXY_TARGET },
      '/ws': { target: WS_PROXY_TARGET, ws: true },
      '/api/upload': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
})
