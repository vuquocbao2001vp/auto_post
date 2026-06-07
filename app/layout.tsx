import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Post MVP",
  description: "Simple Facebook group posting scheduler powered by Supabase and a Chrome extension."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
