/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The agent swarm, contract engine and OutLayer mirror are shared TypeScript sources.
  transpilePackages: ["@paron/agents"],
};

export default nextConfig;
