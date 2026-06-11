import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MediKiosk",
  description: "Smart ER Triage Kiosk",
};

// Lock zoom + scaling for kiosk touchscreen (Pi 7" display)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} bg-slate-950 text-white min-h-screen overflow-hidden`}
        style={{ touchAction: "manipulation" }}
      >
        {children}
      </body>
    </html>
  );
}
