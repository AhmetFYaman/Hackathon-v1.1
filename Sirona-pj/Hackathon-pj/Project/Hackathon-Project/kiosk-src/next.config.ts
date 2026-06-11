import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  env: {
    // Jetson AI server address — set JETSON_AI_URL in environment to override
    NEXT_PUBLIC_JETSON_AI_URL: process.env.JETSON_AI_URL ?? "http://localhost:8000",
    JETSON_AI_URL: process.env.JETSON_AI_URL ?? "http://localhost:8000",
  },
};

export default nextConfig;
