import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // onnxruntime-web (Murshid's in-browser model) loads its .wasm file relative to its own module;
  // Vite's dependency pre-bundling breaks that path in dev, so it is excluded.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
