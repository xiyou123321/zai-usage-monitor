import assert from "assert";
import { getDominantPercentage, getWeeklyTokenItem } from "../../util/quota";
import { QuotaItem, QuotaSummary } from "../../types/api";

/**
 * Build a QuotaSummary that mirrors how GLMUsageService.parseQuotaSummary
 * populates it: tokenUsage.percentage tracks the first TOKENS_LIMIT (5h),
 * mcpUsage.percentage tracks the TIME_LIMIT (monthly), and quotaItems holds
 * the full list (including any second TOKENS_LIMIT labeled "每周").
 */
function makeSummary(opts: {
  tokenPct?: number;
  mcpPct?: number;
  quotaItems?: QuotaItem[];
}): QuotaSummary {
  return {
    tokenUsage: { percentage: opts.tokenPct ?? 0, used: 0, total: 0 },
    mcpUsage: { percentage: opts.mcpPct ?? 0, used: 0, total: 0 },
    monthlyResetAt: "",
    quotaItems: opts.quotaItems,
  };
}

const fiveHour: QuotaItem = {
  type: "TOKENS_LIMIT",
  label: "5小时",
  percentage: 20,
  used: 20,
  total: 100,
};
const weekly: QuotaItem = {
  type: "TOKENS_LIMIT",
  label: "每周",
  percentage: 70,
  used: 70,
  total: 100,
};
const monthly: QuotaItem = {
  type: "TIME_LIMIT",
  label: "每月",
  percentage: 10,
  used: 10,
  total: 100,
};

suite("getWeeklyTokenItem", () => {
  test("returns the 每周 item when present", () => {
    const s = makeSummary({ quotaItems: [fiveHour, weekly, monthly] });
    assert.strictEqual(getWeeklyTokenItem(s), weekly);
  });

  test("returns undefined when only the 5h token limit exists", () => {
    const s = makeSummary({ quotaItems: [fiveHour, monthly] });
    assert.strictEqual(getWeeklyTokenItem(s), undefined);
  });

  test("returns undefined when quotaItems is undefined", () => {
    assert.strictEqual(getWeeklyTokenItem(makeSummary({})), undefined);
  });

  test("returns undefined for null summary", () => {
    assert.strictEqual(getWeeklyTokenItem(null), undefined);
  });
});

suite("getDominantPercentage", () => {
  test("weekly dominates when tp < 50 and weekly is highest", () => {
    const s = makeSummary({
      tokenPct: 20,
      mcpPct: 10,
      quotaItems: [
        { ...fiveHour, percentage: 20 },
        { ...weekly, percentage: 70 },
        { ...monthly, percentage: 10 },
      ],
    });
    assert.strictEqual(getDominantPercentage(s), 70);
  });

  test("5h token dominates when tp >= 50 (ignores weekly)", () => {
    const s = makeSummary({
      tokenPct: 55,
      mcpPct: 10,
      quotaItems: [
        { ...fiveHour, percentage: 55 },
        { ...weekly, percentage: 90 },
        { ...monthly, percentage: 10 },
      ],
    });
    assert.strictEqual(getDominantPercentage(s), 55);
  });

  test("falls back to max(tp, mp) when weekly absent (legacy parity)", () => {
    const s = makeSummary({
      tokenPct: 30,
      mcpPct: 40,
      quotaItems: [
        { ...fiveHour, percentage: 30 },
        { ...monthly, percentage: 40 },
      ],
    });
    assert.strictEqual(getDominantPercentage(s), 40);
  });

  test("returns 0 for null summary", () => {
    assert.strictEqual(getDominantPercentage(null), 0);
  });
});
