import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // Note: Origin-Agent-Cluster is deliberately left at the browser default so
    // WebMCP's per-origin model context keeps its isolation.
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
