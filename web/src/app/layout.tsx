import type { Metadata } from "next";
import { Space_Grotesk, Manrope } from "next/font/google";
import { getPlayerId } from "@/lib/server/utils";
import { DATA_DB } from "@/lib/db";
import { PlayerProvider } from "@/components/context/playerId";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "WordRace",
  description: "A fun word racing game",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  // set up player ID and create player in DB if it doesn't exist
  const playerId = await getPlayerId();

  let player = await DATA_DB.db.query.playerTable.findFirst({where: {id: playerId}});
  
  if (!player) {
    player = await DATA_DB.createPlayerAction(playerId);
  }



  return (
    <html lang="en">
      <body
        className={`${manrope.variable} ${spaceGrotesk.variable} antialiased flex flex-col min-h-screen bg-background text-foreground`}
      >
        <header className="sticky top-0 z-50 w-full border-b border-white bg-chart-1 text-nav-foreground">
          <div className="container flex h-14 items-center justify-center px-6 max-w-6xl mx-auto">
            <span className="text-2xl font-black tracking-tight uppercase">WordRace</span>
          </div>
        </header>
        <PlayerProvider value={player}>
          {children}
        </PlayerProvider>
      </body>
    </html>
  );
}
