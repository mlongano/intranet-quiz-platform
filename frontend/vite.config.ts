import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React and React DOM into a separate vendor chunk
          'react-vendor': ['react', 'react-dom'],
          // Split React Router into its own chunk
          'router': ['react-router-dom'],
          // Split TanStack Query into its own chunk
          'query': ['@tanstack/react-query'],
          // Split Markdown rendering libraries into their own chunk
          'markdown': ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
        },
      },
    },
    chunkSizeWarningLimit: 600, // Increase threshold slightly to suppress warning for remaining main chunk
  },
  server: {
    host: true, // Allow access from other devices on the network
    port: 5173, // Default Vite port
    proxy: {
      // Proxy /api requests to your Flask backend
      "/images": {
        target: "http://localhost:5001", // Your Flask backend URL
        changeOrigin: true, // Recommended for virtual hosted sites
        secure: false, // Optional: Set to false if backend uses self-signed certs (not recommended for prod)
        // Optional: You might not need rewrite if your Flask routes start with /api
        // rewrite: (path) => path.replace(/^\/api/, '/api')
      },
      "/api": {
        target: "http://localhost:5001", // Your Flask backend URL
        changeOrigin: true, // Recommended for virtual hosted sites
        secure: false, // Optional: Set to false if backend uses self-signed certs (not recommended for prod)
        // Optional: You might not need rewrite if your Flask routes start with /api
        // rewrite: (path) => path.replace(/^\/api/, '/api')
      },
    },
  },
});
