import { QuotaItem, QuotaSummary } from "../types/api";

/**
 * Find the weekly TOKENS_LIMIT quota item (label "每周").
 * Returns undefined when the account/plan exposes no weekly limit
 * (the API returned no second TOKENS_LIMIT entry).
 *
 * Matched by label rather than array index so API ordering changes cannot
 * cause the wrong item to be picked up.
 */
export function getWeeklyTokenItem(
  summary: QuotaSummary | null | undefined,
): QuotaItem | undefined {
  const items = summary?.quotaItems;
  if (!items || items.length === 0) return undefined;
  return items.find(
    (item) => item.type === "TOKENS_LIMIT" && item.label === "每周",
  );
}

/**
 * Dominant usage percentage driving status bar color.
 *
 * The 5-hour Token window (tp) is prioritized once it reaches >= 50%,
 * because it resets fastest and is the most urgent short-term constraint.
 * Otherwise take the max across Token (5h), weekly Token, and MCP, so any
 * quota near its limit can drive the warning color.
 */
export function getDominantPercentage(
  summary: QuotaSummary | null | undefined,
): number {
  if (!summary) return 0;
  const tp = summary.tokenUsage.percentage;
  const mp = summary.mcpUsage.percentage;
  const wp = getWeeklyTokenItem(summary)?.percentage ?? 0;
  return tp >= 50 ? tp : Math.max(tp, mp, wp);
}
