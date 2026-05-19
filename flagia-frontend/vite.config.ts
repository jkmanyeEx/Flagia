import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 3501,
    proxy: {
      '/api': {
        target: 'http://localhost:3502',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3502',
        ws: true,
      },
    },
  },
})
