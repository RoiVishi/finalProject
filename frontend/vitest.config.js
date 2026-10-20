import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests (React screens in a simulated browser, jsdom).
 * Only *.test.jsx files run here; the existing *.test.js unit tests stay on
 * `node --test`. `npm test` runs both.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx'],
    css: false,
  },
});
