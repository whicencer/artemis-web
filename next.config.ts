import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.nasa.gov"
      },
      {
        protocol: "https",
        hostname: "images-assets.nasa.gov"
      }
    ]
  }
};

export default nextConfig;
