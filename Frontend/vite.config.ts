import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Must match the GitHub repo name (Pages serves at /<repo>/): Golden007-prog/Govt-Prep
  base: '/Govt-Prep/',
})
