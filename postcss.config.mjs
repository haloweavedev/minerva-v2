/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: [
    '@tailwindcss/postcss',
    // 'tailwindcss/nesting': {}, // Removed - v4 includes nesting
  ],
};

export default config;
