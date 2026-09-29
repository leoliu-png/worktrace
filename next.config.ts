import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '27mb' } },
};
export default nextConfig;
