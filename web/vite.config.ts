import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// La función `api` en el emulador de Functions (npm run emuladores). Las
// imágenes de civs y mapas salen de web/public/assets, sin proxy.
const API = process.env.API_TARGET || 'http://127.0.0.1:5001/demo-aoe3draft/southamerica-east1/api';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // xfwd agrega x-forwarded-host: el backend necesita saber que el
      // navegador habla con :5173 para armar los retornos de Steam y Google.
      '/api': { target: API, changeOrigin: true, xfwd: true },
    },
  },
});
