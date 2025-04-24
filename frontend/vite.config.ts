import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // Allow access from other devices on the network
    port: 5173, // Default Vite port
    proxy: {
      // Proxy /api requests to your Flask backend
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
