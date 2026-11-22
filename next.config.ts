import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

const nextConfig: NextConfig = {
  // Nested inside the home-dir git repo: pin the root so Turbopack doesn't infer it.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
}

export default nextConfig
