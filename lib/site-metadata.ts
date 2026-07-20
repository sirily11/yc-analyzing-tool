import type { Metadata } from "next";

export const SITE_NAME = "Application Signal";

export const PAGE_SHARE = {
  home: {
    browserTitle: "Application Signal — YC fit, explained",
    socialTitle: "See where your startup fits.",
    description:
      "Explore five years of public YC companies and generate a private, data-informed application fit report.",
    eyebrow: "PUBLIC DIRECTORY · 2022—2026 YTD",
  },
  login: {
    browserTitle: "Sign in",
    socialTitle: "Private analysis. Public context.",
    description:
      "Sign in to a private founder workspace for evidence-led startup analysis and visual fit reports.",
    eyebrow: "FOUNDER WORKSPACE",
  },
  dashboard: {
    browserTitle: "Founder workspace",
    socialTitle: "Your application signal workspace.",
    description:
      "Review private startup analyses, compare reports, and keep every founder conversation in one workspace.",
    eyebrow: "PRIVATE WORKSPACE",
  },
  newAnalysis: {
    browserTitle: "New analysis",
    socialTitle: "Start a new startup analysis.",
    description:
      "Describe your startup or upload a plan to create a private, evidence-led fit report.",
    eyebrow: "NEW ANALYSIS",
  },
  chat: {
    browserTitle: "Private analysis",
    socialTitle: "Turn your startup plan into evidence.",
    description:
      "Build a private startup profile, examine the evidence, and generate a practical visual fit report.",
    eyebrow: "PRIVATE ANALYSIS",
  },
  report: {
    browserTitle: "Private YC fit report",
    socialTitle: "A private, data-informed YC fit report.",
    description:
      "Explore a startup's position, strengths, gaps, and next-draft recommendations against recent public YC patterns.",
    eyebrow: "VISUAL FIT REPORT",
  },
  companyReport: {
    browserTitle: "Private YC company research",
    socialTitle: "A private public-company research report.",
    description: "Compare public YC companies through cited web research and a request-specific semantic cluster map.",
    eyebrow: "COMPANY RESEARCH",
  },
} as const;

export type PageShareKey = keyof typeof PAGE_SHARE;

function withProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function getMetadataBase() {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.AUTH_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;

  return new URL(configured ? withProtocol(configured) : "http://localhost:3000");
}

export function createPageMetadata(
  key: PageShareKey,
  path: string,
  options: { privatePage?: boolean } = {},
): Metadata {
  const page = PAGE_SHARE[key];

  return {
    title: page.browserTitle,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: SITE_NAME,
      title: page.socialTitle,
      description: page.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.socialTitle,
      description: page.description,
    },
    ...(options.privatePage ? { robots: { index: false, follow: false } } : {}),
  };
}
