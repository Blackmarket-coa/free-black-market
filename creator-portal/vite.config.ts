import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const API_URL =
    env.VITE_FBM_API_URL || env.VITE_MEDUSA_BACKEND_URL || "http://localhost:9000"

  return {
    plugins: [react({ fastRefresh: true })],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      host: true,
      port: parseInt(process.env.PORT || "7003"),
      open: false,
      proxy: {
        "/api": {
          target: API_URL,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    build: {
      target: "es2020",
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-charts": ["recharts"],
          },
        },
      },
    },
  }
})
