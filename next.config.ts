import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded with Node's own require so they can use fs/zlib.
  serverExternalPackages: ["exifr", "web-push"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
