import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api, /media and /uploads go to the local server (npm start on :3002).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3002', '/media': 'http://localhost:3002', '/uploads': 'http://localhost:3002' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
