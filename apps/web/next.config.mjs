/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @demoforge/shared ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@demoforge/shared"],
  webpack(config) {
    // The shared source imports its own files as "./x.js"; resolve those to the .ts files.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
export default nextConfig;
