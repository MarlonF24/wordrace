import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const existingId = request.cookies.get('playerId')?.value;
  
  const playerId = existingId || crypto.randomUUID(); // only regenerate if new or cookie expired (last visit was more than 400 days ago)

  const response = NextResponse.next();

  response.cookies.set('playerId', playerId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 400, // reset cookie to 400 days every time
    httpOnly: true,            
    sameSite: 'lax',            
    // secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in prod
  });

  return response;
}

// Ensure this only runs on page routes, not images/assets
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
