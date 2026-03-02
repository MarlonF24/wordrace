import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getPlayerId } from "@/lib/server/utils";
import { DATA_DB } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

  const player = await DATA_DB.db.query.playerTable.findFirst({where: {id: playerId}});
  
  if (!player) {
    await DATA_DB.createPlayer(playerId);
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen bg-background text-foreground`}
      >
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
          <div className="container flex h-16 items-center px-4">
            <h1 className="text-xl font-bold tracking-tight">WordRace</h1>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
