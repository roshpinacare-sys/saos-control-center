import { NextResponse } from 'next/server';

export async function GET() {
  const responseHeaders = new Headers();
  
  // Content Security Policy
  responseHeaders.set(
    'Content-Security-Policy',
    "script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  
  // Strict Transport Security
  responseHeaders.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  
  // Prevent Clickjacking
  responseHeaders.set('X-Frame-Options', 'DENY');
  
  // Prevent MIME-sniffing
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  
  // Referrer Policy
  responseHeaders.set('Referrer-Policy', 'no-referrer');
  
  // Permissions Policy
  responseHeaders.set(
    'Permissions-Policy',
    'accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), bluetooth=(), camera=(), cross-origin-isolated=(), display-capture=(), document-domain=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), storage-access=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()'
  );
  
  // Additional security headers
  responseHeaders.set('X-XSS-Protection', '1; mode=block');
  responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Expires', '0');
  
  // Mock response data
  const responseData = {
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: '72h 15m'
  };
  
  return NextResponse.json(responseData, {
    headers: responseHeaders,
    status: 200
  });
}
