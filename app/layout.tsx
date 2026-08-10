import type { Metadata } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  const title = "Role Radar — private product career intelligence";
  const description =
    "Private, candidate-specific product job discovery with resume fit, priority calibration, company context, and application tracking.";

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
