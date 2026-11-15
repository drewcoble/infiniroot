import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    tanstackRouter({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@shared-core': path.resolve(__dirname, '../shared-core'),
      '@infinidata': path.resolve(__dirname, '../infinidata/convex/_generated'),
      // The playoff rules engine runs in the browser too (picture, what-ifs,
      // odds) - plain TS with no Convex imports.
      '@playoffRules': path.resolve(__dirname, '../infinidata/convex/lib/playoffRules'),
    },
  },
  server: {
    // 5050 = infinidraft, 5051 = infinileague, 5052 = infinifaab.
    port: 5053,
  },
})
