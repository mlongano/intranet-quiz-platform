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
        // Use a function-based manualChunks to split large dependencies into focused chunks
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            // React ecosystem - keep together to avoid module resolution issues
            if (id.match(/\/node_modules\/(react|react-dom|scheduler)\//)) {
              return 'react-vendor';
            }

            // Router
            if (id.includes('react-router-dom')) return 'router';

            // React Query
            if (id.includes('@tanstack/react-query') && !id.includes('devtools')) {
              return 'query';
            }

            // Prism and rehype-prism (syntax highlighting) - lazy loaded in admin
            if (id.includes('rehype-prism-plus') || id.includes('prismjs')) {
              return 'prism';
            }

            // JSON/C parsing - lazy loaded in admin
            if (id.includes('jsonc-parser')) {
              return 'jsonc';
            }

            // Everything else stays in vendor (including markdown ecosystem)
            return 'vendor';
          }
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
