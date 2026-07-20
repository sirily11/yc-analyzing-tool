import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { PAGE_SHARE, SITE_NAME, type PageShareKey } from "@/lib/site-metadata";

const imageSize = { width: 1200, height: 630 };

export async function renderOpenGraphImage(key: PageShareKey) {
  const page = PAGE_SHARE[key];
  const background = await readFile(
    path.join(process.cwd(), "public/brand/application-signal-map.jpg"),
    "base64",
  );

  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#f3efe5",
        color: "#25211d",
        fontFamily: "sans-serif",
      }}
    >
      <img
        alt=""
        src={`data:image/jpeg;base64,${background}`}
        width={imageSize.width}
        height={imageSize.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage:
            "linear-gradient(90deg, rgba(243,239,229,0.99) 0%, rgba(243,239,229,0.97) 47%, rgba(243,239,229,0.52) 67%, rgba(243,239,229,0) 83%)",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "54px 62px 48px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 46,
              height: 46,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#d85b35",
              color: "#fffaf0",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ display: "flex", fontSize: 19, fontWeight: 750, letterSpacing: "0.08em" }}>
            {SITE_NAME.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", width: 680 }}>
          <div
            style={{
              display: "flex",
              color: "#a83e20",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.12em",
              marginBottom: 18,
            }}
          >
            {page.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: page.socialTitle.length > 36 ? 54 : 62,
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
              fontWeight: 650,
              marginBottom: 22,
            }}
          >
            {page.socialTitle}
          </div>
          <div style={{ display: "flex", width: 610, color: "#565047", fontSize: 22, lineHeight: 1.38 }}>
            {page.description}
          </div>
        </div>

        <div style={{ display: "flex", color: "#70695f", fontSize: 13, letterSpacing: "0.11em" }}>
          INDEPENDENT YC DIRECTORY ANALYSIS
        </div>
      </div>
    </div>,
    imageSize,
  );
}
