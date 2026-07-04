import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PLAYER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/**
 * Ensure every page request has a stable anonymous player identity.
 *
 * The ID is stored in an HTTP-only cookie and is used by server actions to find
 * or create the player row without exposing credentials or account state.
 */
export function proxy(request: NextRequest) {
  const existingId = request.cookies.get('playerId')?.value;
  
  const playerId = existingId || crypto.randomUUID();

  const response = NextResponse.next();

  response.cookies.set('playerId', playerId, {
    path: '/',
    maxAge: PLAYER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,            
    sameSite: 'lax',            
    // secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in prod
  });

  return response;
}

// Keep the player cookie on app pages without running proxy work for assets.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
