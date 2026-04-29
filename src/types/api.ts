/** API response for quota limits */
export interface QuotaLimitResponse {
  limits: QuotaLimit[];
  level: string; // 套餐类型
}

export interface QuotaLimit {
  type: "TOKENS_LIMIT" | "TIME_LIMIT";
  percentage: number;
  currentValue?: string | number;
  currentUsage?: string | number;
  used?: string | number;
  usage?: string | number;
  total?: string | number;
  totol?: string | number; // Note: API has a typo "totol"
  nextResetTime?: string | number; // Timestamp in milliseconds
  unit?: number;
  number?: number;
  remaining?: number;
  usageDetails?: Record<string, unknown> | Array<Record<string, unknown>>;
}

/** API response for model/tool usage */
export interface UsageResponse {
  code?: number;
  msg?: string;
  data?: unknown;
  success?: boolean;
}

export interface ModelSummaryItem {
  modelName: string;
  totalTokens: number;
  sortOrder: number;
}

/** Model usage response data */
export interface ModelUsageData {
  totalUsage: {
    totalModelCallCount: number;
    totalTokensUsage: number;
    modelSummaryList?: ModelSummaryItem[];
  };
}

export interface ToolDetailItem {
  modelName: string;
  totalUsageCount: number;
}

export interface ToolSummaryItem {
  toolCode: string;
  toolName: string;
  totalUsageCount: number;
  sortOrder: number;
}

/** Tool usage response data */
export interface ToolUsageData {
  totalUsage: {
    totalNetworkSearchCount: number;
    totalWebReadMcpCount: number;
    totalZreadMcpCount: number;
    totalSearchMcpCount: number;
    toolDetails?: ToolDetailItem[];
    toolSummaryList?: ToolSummaryItem[];
  };
}

export interface UsageData {
  timestamp: string;
  model?: string;
  tool?: string;
  tokens?: number;
  requests?: number;
}

/** Combined usage data for UI */
export interface CombinedUsageData {
  quotaLimits: QuotaLimitResponse;
  modelUsage: UsageResponse;
  toolUsage: UsageResponse;
  timestamp: string;
}

/** A single parsed quota item for display */
export interface QuotaItem {
  type: "TOKENS_LIMIT" | "TIME_LIMIT";
  label: string;
  percentage: number;
  used: number;
  total: number;
  resetAt?: string;
}

/** Display-friendly quota summary */
export interface QuotaSummary {
  tokenUsage: { percentage: number; used: number; total: number };
  mcpUsage: { percentage: number; used: number; total: number };
  /** Token reset time (hourly, display as 时分) */
  tokenResetAt?: string;
  /** MCP reset time (monthly, display as 年月日时分) */
  mcpResetAt?: string;
  /** @deprecated Use tokenResetAt and mcpResetAt instead */
  monthlyResetAt: string;
  /** All parsed quota items from API (may contain multiple token/mcp limits) */
  quotaItems?: QuotaItem[];
  /** Token数 consumed in the query time period */
  consumedTokens?: number;
  /** Model usage details in the query time period */
  modelUsageDetails?: ModelUsageData;
  /** MCP tool calls in the query time period */
  mcpToolCalls?: {
    totalNetworkSearchCount: number;
    totalWebReadMcpCount: number;
    totalZreadMcpCount: number;
    totalSearchMcpCount: number;
  };
  /** MCP tool details in the query time period */
  toolUsageDetails?: ToolUsageData;
  /** Credential source for display */
  credentialSource?: "claude" | "env" | "manual";
  /** Last refresh time */
  lastRefreshTime?: string;
  /** Next scheduled refresh time */
  nextRefreshTime?: string;
  /** 是否处于离线模式（使用缓存数据） */
  isOffline?: boolean;
  /** 模型 token 用量时序数据（用于折线图） */
  modelTimeSeries?: ModelTimeSeries;
  /** 套餐类型 */
  level?: string;
}

export type UsageRange = "today" | "last7Days" | "last30Days";

export interface UsageRangeOption {
  key: UsageRange;
  label: string;
}

export interface UsageMetricSummary {
  name: string;
  tokens: number;
  requests: number;
}

export interface DetailedUsageSnapshot {
  range: UsageRange;
  rangeLabel: string;
  summary: QuotaSummary;
  modelUsage: UsageMetricSummary[];
  toolUsage: UsageMetricSummary[];
  fetchedAt: string;
}

/** Platform type */
export type Platform = "ZAI" | "ZHIPU";

/** API configuration */
export interface ApiConfig {
  authToken: string;
  baseUrl: string;
}

/** Chart data point for trend visualization */
export interface ChartDataPoint {
  date: string;
  dateLabel: string;
  tokensUsed: number;
  mcpCalls: number;
}

/** Chart dataset for rendering */
export interface ChartDataset {
  label: string;
  data: ChartDataPoint[];
  color: string;
  unit: string;
}

/** Panel view type */
export type PanelViewType = "overview" | "trend" | "details";

/** 单个模型的时序数据 */
export interface ModelTimeSeriesItem {
  modelName: string;
  tokensUsage: number[];
  totalTokens: number;
}

/** 模型 token 用量时序数据 */
export interface ModelTimeSeries {
  xTime: string[];
  granularity: "hourly" | "daily";
  totalTokensUsage: number[];
  models: ModelTimeSeriesItem[];
}
