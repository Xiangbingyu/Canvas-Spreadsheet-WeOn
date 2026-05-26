import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': { target: 'http://localhost:3000' },
      '/docs': { target: 'http://localhost:3000' },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
