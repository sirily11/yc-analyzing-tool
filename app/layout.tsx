import type { Metadata } from "next";
import "./globals.css";
import { createPageMetadata, getMetadataBase, PAGE_SHARE, SITE_NAME } from "@/lib/site-metadata";

export const metadata: Metadata = {
  ...createPageMetadata("home", "/"),
  title: {
    default: PAGE_SHARE.home.browserTitle,
    template: "%s · Application Signal",
  },
  applicationName: SITE_NAME,
  metadataBase: getMetadataBase(),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
