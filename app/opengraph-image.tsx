import { renderOpenGraphImage } from "@/lib/open-graph-image";

export const alt = "See where your startup fits with Application Signal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

export default function Image() {
  return renderOpenGraphImage("home");
}
