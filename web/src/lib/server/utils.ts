import { cookies } from "next/headers";

export async function getPlayerId() {
  const cookieStore = await cookies();
  const playerId = cookieStore.get('playerId')?.value;

  if (!playerId) throw new Error("Player ID not found in cookies");

  return playerId;
}



