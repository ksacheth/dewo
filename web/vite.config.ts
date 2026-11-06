import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { dewoServer } from "./server/events"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react(), dewoServer()],
    server: {
      // The Requester API (M4) is proxied so the browser needs no CORS; unset means the "mock requester" is used.
      // REQUESTER_API_TOKEN (R13) is added here, server-side only: it has no VITE_ prefix, so it never reaches the browser bundle.
      proxy: env.VITE_REQUESTER_URL
        ? {
            "/requester": {
              target: env.VITE_REQUESTER_URL,
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/requester/, ""),
              headers: env.REQUESTER_API_TOKEN ? { Authorization: `Bearer ${env.REQUESTER_API_TOKEN}` } : undefined,
            },
          }
        : undefined,
    },
  }
})
