import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(),
  // Bundle visualizer: generates dist/bundle-report.html after build
  visualizer({ filename: 'dist/bundle-report.html', title: 'Bundle report' })
  ],
  build: {
    rollupOptions: {
      output: {
        // Simplified manual chunks - avoid splitting React core
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            // Keep ALL React-related stuff together (React, ReactDOM, scheduler)
            // This prevents "Cannot read properties of undefined" errors
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor';
            }

            // Separate heavy libraries that don't depend on React internals
            if (id.includes('prismjs')) {
              return 'prism';
            }

            if (id.includes('jsonc-parser')) {
              return 'jsonc';
            }

            // Everything else in one vendor chunk
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000, // Increase threshold to suppress warnings
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
