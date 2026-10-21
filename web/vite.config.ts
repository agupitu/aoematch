import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // xfwd agrega x-forwarded-host: el backend necesita saber que el
      // navegador habla con :5173 para armar los retornos de Steam y Google.
      '/api': { target: API, changeOrigin: true, xfwd: true },
      '/assets': { target: API, changeOrigin: true },
      '/ws': { target: API, ws: true },
    },
  },
});
