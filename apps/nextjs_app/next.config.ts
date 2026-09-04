import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ['tydantic-settings'],
    typedRoutes: true,
};

export default nextConfig;
