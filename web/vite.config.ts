import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Real mode: /api and /webhooks are proxied to the backend (override with VITE_API_PROXY).
const target = process.env.VITE_API_PROXY || 'http://localhost:5000'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': target } },
})
