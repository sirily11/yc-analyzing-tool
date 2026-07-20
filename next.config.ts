import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  serverExternalPackages: ["@react-pdf/renderer", "zod"],
  turbopack: {},
};

export default withWorkflow(nextConfig);
