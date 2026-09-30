import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Barlow_Condensed, Graduate } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import { UserTeamProvider } from "@/lib/user-context";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
});

const graduate = Graduate({
  variable: "--font-graduate",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Build Your Franchise",
  description: "Rosters, cap, trades, extensions and free agency for the Build Your Franchise Sleeper league",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${barlowCondensed.variable} ${graduate.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <UserTeamProvider>
          <Nav />
          <main className="flex-1">{children}</main>
        </UserTeamProvider>
      </body>
    </html>
  );
}
