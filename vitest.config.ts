import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
