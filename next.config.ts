import type {NextConfig} from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // Prototype image hosts (placehold.co, picsum.photos) removed: Doc 05 TD-014, Doc 19 TEST-406.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default nextConfig;
