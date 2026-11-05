import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { dewoServer } from "./server/events"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react(), dewoServer()],
    server: {
      // The Requester API (M4) is proxied so the browser needs no CORS; unset means the "mock requester" is used.
      proxy: env.VITE_REQUESTER_URL ? { "/requester": { target: env.VITE_REQUESTER_URL, changeOrigin: true, rewrite: (p) => p.replace(/^\/requester/, "") } } : undefined,
    },
  }
})
