/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Disable server-side features for Electron
  trailingSlash: true,
  // Use relative paths for assets in static export (critical for Electron file:// protocol)
  assetPrefix: './',
  // Ensure base path works correctly
  basePath: '',
};

module.exports = nextConfig;
