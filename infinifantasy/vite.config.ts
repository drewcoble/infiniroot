import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Plain multi-page static site - no React/Mantine/Convex, so the marketing
// pages stay fast and fully crawlable. Each page is its own HTML entry; add
// app detail pages (e.g. draft/index.html) to `input` as they're built.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    // 5050-5053 are the apps - this is the next free port.
    port: 5054,
  },
})
