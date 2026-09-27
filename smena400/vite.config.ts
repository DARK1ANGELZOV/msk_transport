import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * В разработке фронтенд живёт на 5173 и ходит в API на 5400 через прокси,
 * поэтому в коде клиента нет ни одного абсолютного адреса сервера.
 * В сборке тот же сервер отдаёт и статику, и API — адрес совпадает.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:5400', changeOrigin: true } }
  },
  build: { outDir: 'dist', sourcemap: true }
})
