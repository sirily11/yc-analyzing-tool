export const CHAT_AUTO_SCROLL_THRESHOLD_PX = 160;

type ScrollMetrics = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;
type ChatAutoScrollState = { following: boolean; scrolling: boolean };

export function isNearChatScrollEnd(metrics: ScrollMetrics, threshold = CHAT_AUTO_SCROLL_THRESHOLD_PX) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function updateChatAutoScrollState(state: ChatAutoScrollState, nearEnd: boolean): ChatAutoScrollState {
  if (state.scrolling) return { following: state.following, scrolling: !nearEnd };
  return { following: nearEnd, scrolling: false };
}
