import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<ユーザー名>.github.io/shindans/ で公開されるため、base を合わせる
export default defineConfig({
  base: '/shindans/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
  },
});
