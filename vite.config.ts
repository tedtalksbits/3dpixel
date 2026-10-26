import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5178,
    // OneDrive folders don't reliably emit file change events
    watch: { usePolling: true, interval: 300 },
  },
});
