import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/__/auth': {
        target: 'https://stranger-meet-33687.firebaseapp.com',
        changeOrigin: true,
        secure: true
      }
    }
  }
})
