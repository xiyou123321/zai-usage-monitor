import { UsageRange, UsageRangeOption } from '../types/api';

/**
 * Available time range presets for usage detail queries.
 */
export const USAGE_RANGE_OPTIONS: UsageRangeOption[] = [
  { key: 'today', label: '当天' },
  { key: 'last7Days', label: '最近 7 天' },
  { key: 'last30Days', label: '最近 30 天' },
];

/**
 * Calculate time window for API queries using local time.
 */
export function getTimeWindowParams(
  range: UsageRange = 'today',
  now: Date = new Date(),
): {
  startTime: string;
  endTime: string;
} {
  const start = new Date(now);
  const end = new Date(now);

  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === 'last7Days') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return {
    startTime: formatDateTime(start),
    endTime: formatDateTime(end),
  };
}

export function getUsageRangeLabel(range: UsageRange): string {
  return (
    USAGE_RANGE_OPTIONS.find((option) => option.key === range)?.label ?? range
  );
}

export function getNextMonthlyResetTime(now: Date = new Date()): string {
  const resetTime = new Date(now);
  resetTime.setMonth(resetTime.getMonth() + 1, 1);
  resetTime.setHours(0, 0, 0, 0);
  return resetTime.toISOString();
}

export function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Detect platform from base URL
 */
export function detectPlatform(baseUrl: string): 'ZAI' | 'ZHIPU' {
    if (baseUrl.includes('z.ai')) {
        return 'ZAI';
    }
    return 'ZHIPU';
}
