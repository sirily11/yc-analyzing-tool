"use client";

import { useCallback, useEffect, useRef } from "react";
import { REPORT_MAP_HEIGHT, REPORT_MAP_WIDTH } from "@/lib/report-map";

export type ReportMapCanvasPoint = {
  id: number;
  x: number;
  y: number;
  radius: number;
  fill: string;
  opacity: number;
  stroke?: string;
  strokeWidth?: number;
};

export function ReportMapPointCanvas({ points, activeId }: { points: ReportMapCanvasPoint[]; activeId: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => undefined);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const scale = Math.min(width / REPORT_MAP_WIDTH, height / REPORT_MAP_HEIGHT);
    const offsetX = (width - REPORT_MAP_WIDTH * scale) / 2;
    const offsetY = (height - REPORT_MAP_HEIGHT * scale) / 2;
    for (const point of points) {
      const active = point.id === activeId;
      context.beginPath();
      context.arc(offsetX + point.x * scale, offsetY + point.y * scale, active ? 7 : point.radius, 0, Math.PI * 2);
      context.fillStyle = active ? "#25211d" : point.fill;
      context.globalAlpha = active ? 1 : point.opacity;
      context.fill();
      const stroke = active ? "#f3efe5" : point.stroke;
      const strokeWidth = active ? 2 : point.strokeWidth;
      if (stroke && strokeWidth) {
        context.strokeStyle = stroke;
        context.lineWidth = strokeWidth;
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }, [activeId, points]);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(draw, [draw]);

  return <canvas ref={canvasRef} className="report-cluster-point-canvas" aria-hidden="true" />;
}
