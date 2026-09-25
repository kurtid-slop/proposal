import { defineConfig } from 'vite';
import crops from './crops-plugin.js';
import photos from './photos-plugin.js';

// Relative base so the build works at https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  plugins: [photos(), crops()],
});
