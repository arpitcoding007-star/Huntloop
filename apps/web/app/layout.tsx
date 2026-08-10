import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Huntloop",
  description:
    "AI-powered closed-loop outbound growth engine — discover, qualify, enrich, reach out, track, learn, improve.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
