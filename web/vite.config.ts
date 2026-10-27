import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Sin servidor (plan Spark): la web habla directo con Firebase. Las imágenes
// de civs y mapas salen de web/public/assets.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
