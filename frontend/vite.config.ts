import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {});
          proxy.on('proxyReqWs', () => {});
        },
      },
    },
  },
})
