import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El servidor escucha en 0.0.0.0 y acepta cualquier host porque la app se sirve
// detrás de un proxy (preview) con dominio propio. Sin `allowedHosts` Vite
// rechazaría esas peticiones y el preview quedaría roto.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    headers: {
      // Permite usar el micrófono desde el iframe del preview.
      'Permissions-Policy': 'microphone=*, display-capture=*',
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
