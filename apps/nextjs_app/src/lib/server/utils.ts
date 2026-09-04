import { cookies } from "next/headers";

/**
 * Return the anonymous player ID assigned by `proxy.ts`.
 *
 * Server actions and route loaders use this as their player identity boundary.
 * Missing cookies are treated as a request setup error because the proxy should
 * assign the cookie before page handlers run.
 */
export async function getPlayerId() {
  const cookieStore = await cookies();
  const playerId = cookieStore.get('playerId')?.value;

  if (!playerId) throw new Error("Player ID not found in cookies");

  return playerId;
}



