import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @huntloop/ui ships TypeScript source, not a build artifact.
  transpilePackages: ["@huntloop/ui"],
};

export default nextConfig;
