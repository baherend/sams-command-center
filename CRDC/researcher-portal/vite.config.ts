import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
          // Empty (0 kB) only when built without VITE_SUPABASE_URL/ANON_KEY: Vite then drops createClient as dead code.
          if (/node_modules\/@supabase\//.test(id)) return 'vendor-supabase'
          return undefined
        },
      },
    },
  },

  // onnxruntime-web (Murshid's in-browser model) loads its .wasm file relative to its own module;
  // Vite's dependency pre-bundling breaks that path in dev, so it is excluded.
  optimizeDeps: { exclude: ['onnxruntime-web'] },

})
