export const CHAT_AUTO_SCROLL_THRESHOLD_PX = 160;

type ScrollMetrics = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;

export function isNearChatScrollEnd(metrics: ScrollMetrics, threshold = CHAT_AUTO_SCROLL_THRESHOLD_PX) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}
