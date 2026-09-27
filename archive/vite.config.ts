import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * В разработке фронт живёт на 5173, API — на 8787, и запросы проксируются.
 * В сборке всё отдаёт один сервер из dist/, поэтому адреса относительные
 * и ничего не нужно настраивать при развёртывании.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom']
        }
      }
    }
  }
})
