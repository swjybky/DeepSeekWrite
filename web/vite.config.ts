import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    fs: { allow: [workspaceRoot] },
  },
})
