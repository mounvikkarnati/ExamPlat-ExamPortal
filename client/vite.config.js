import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server MUST bind to port 5175 (strictPort prevents silent fallback).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
    strictPort: true,
  },
  preview: {
    port: 5175,
    strictPort: true,
  },
});