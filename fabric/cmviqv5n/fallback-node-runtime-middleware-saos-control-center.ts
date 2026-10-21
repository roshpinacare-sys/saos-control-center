import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for runtime-aware authentication fallback
 * Routes requests to Node runtime when Edge Runtime lacks required features
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Identify paths requiring Node.js runtime features
  const nodeRequiredPaths = [
    '/api/audit',
    '/api/chat',
    '/api/dx',
    '/api/fuel',
    '/api/guard',
    '/api/guardian',
    '/api/health',
    '/api/legion',
    '/api/relay-token',
    '/api/task',
    '/api/agent/bounty',
    '/api/agent/message',
    '/api/agent/register',
    '/api/agent/task',
    '/api/live/bridge',
    '/api/live/markets',
    '/api/live/networks',
    '/api/live/quote',
    '/api/live/tokens',
    '/api/live/versus',
    '/api/saos/bounty',
    '/api/saos/custody-alert',
    '/api/saos/economy',
    '/api/saos/energy',
    '/api/saos/kernel',
    '/api/saos/proof-status',
    '/api/saos/research',
    '/api/saos/revenue',
    '/api/saos/rpc-mesh',
    '/api/saos/seal',
    '/api/saos/soldiers',
    '/api/saos/status',
    '/api/saos/value-engine',
    '/api/saos/verify-pack',
    '/api/swap/chains',
    '/api/swap/execute',
    '/api/swap/quotes',
    '/api/swap/status',
    '/api/swap/universe',
    '/api/vault/addresses',
    '/api/vault/challenge',
    '/api/vault/crossing',
    '/api/vault/estate',
    '/api/vault/login',
    '/api/vault/logout',
    '/api/vault/sovereign',
    '/api/vault/status',
    '/api/vault/treasury',
    '/api/vault/verify'
  ];
  
  // Check if current path requires Node.js runtime
  const requiresNodeRuntime = nodeRequiredPaths.some(path => 
    pathname.startsWith(path)
  );
  
  if (requiresNodeRuntime) {
    // In a real implementation, we would check the runtime environment here
    // For this example, we'll always route to Node runtime for these paths
    
    // Create a response that will be handled by Node.js
    const response = NextResponse.next();
    
    // Add a header to indicate this request should be handled by Node runtime
    response.headers.set('x-runtime-destination', 'node');
    
    return response;
  }
  
  // For other paths, continue with normal flow
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/audit/:path*',
    '/api/chat/:path*',
    '/api/dx/:path*',
    '/api/fuel/:path*',
    '/api/guard/:path*',
    '/api/guardian/:path*',
    '/api/health/:path*',
    '/api/legion/:path*',
    '/api/relay-token/:path*',
    '/api/task/:path*',
    '/api/agent/bounty/:path*',
    '/api/agent/message/:path*',
    '/api/agent/register/:path*',
    '/api/agent/task/:path*',
    '/api/live/bridge/:path*',
    '/api/live/markets/:path*',
    '/api/live/networks/:path*',
    '/api/live/quote/:path*',
    '/api/live/tokens/:path*',
    '/api/live/versus/:path*',
    '/api/saos/bounty/:path*',
    '/api/saos/custody-alert/:path*',
    '/api/saos/economy/:path*',
    '/api/saos/energy/:path*',
    '/api/saos/kernel/:path*',
    '/api/saos/proof-status/:path*',
    '/api/saos/research/:path*',
    '/api/saos/revenue/:path*',
    '/api/saos/rpc-mesh/:path*',
    '/api/saos/seal/:path*',
    '/api/saos/soldiers/:path*',
    '/api/saos/status/:path*',
    '/api/saos/value-engine/:path*',
    '/api/saos/verify-pack/:path*',
    '/api/swap/chains/:path*',
    '/api/swap/execute/:path*',
    '/api/swap/quotes/:path*',
    '/api/swap/status/:path*',
    '/api/swap/universe/:path*',
    '/api/vault/addresses/:path*',
    '/api/vault/challenge/:path*',
    '/api/vault/crossing/:path*',
    '/api/vault/estate/:path*',
    '/api/vault/login/:path*',
    '/api/vault/logout/:path*',
    '/api/vault/sovereign/:path*',
    '/api/vault/status/:path*',
    '/api/vault/treasury/:path*',
    '/api/vault/verify/:path*'
  ]
};