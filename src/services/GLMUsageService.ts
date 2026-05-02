import * as https from "https";
import { CacheService } from "../core/CacheService";
import {
  ApiConfig,
  DetailedUsageSnapshot,
  ModelTimeSeries,
  ModelTimeSeriesItem,
  ModelUsageData,
  ModelSummaryItem,
  QuotaItem,
  QuotaLimit,
  QuotaLimitResponse,
  QuotaSummary,
  ToolDetailItem,
  ToolSummaryItem,
  ToolUsageData,
  UsageMetricSummary,
  UsageRange,
  UsageResponse,
} from "../types/api";
import {
  getNextMonthlyResetTime,
  getTimeWindowParams,
  getUsageRangeLabel,
} from "../util/timeWindow";

export class GLMUsageService {
  private cache: CacheService;
  private isOnline = true;
  private lastNetworkError: string | null = null;

  constructor(
    private config: ApiConfig,
    cache?: CacheService,
    private cacheEnabled: boolean = true,
  ) {
    this.cache = cache ?? new CacheService();
  }

  /**
   * 获取当前网络状态
   */
  getNetworkStatus(): { isOnline: boolean; error: string | null } {
    return { isOnline: this.isOnline, error: this.lastNetworkError };
  }

  /**
   * 重置网络状态
   */
  resetNetworkStatus(): void {
    this.isOnline = true;
    this.lastNetworkError = null;
  }

  /**
   * Fetch all usage data
   * 返回类型改为可能为 null
   */
  async fetchAllUsage(): Promise<{
    quotaLimits: QuotaLimitResponse | null;
    modelUsage: UsageResponse | null;
    toolUsage: UsageResponse | null;
  }> {
    return this.fetchUsageByRange("today");
  }

  async fetchUsageByRange(range: UsageRange): Promise<{
    quotaLimits: QuotaLimitResponse | null;
    modelUsage: UsageResponse | null;
    toolUsage: UsageResponse | null;
  }> {
    const [quotaLimits, modelUsage, toolUsage] = await Promise.all([
      this.fetchQuotaLimits(),
      this.fetchModelUsage(range),
      this.fetchToolUsage(range),
    ]);

    return { quotaLimits, modelUsage, toolUsage };
  }

  /**
   * Fetch quota limits with optional caching
   * 失败时返回缓存数据或默认值
   */
  async fetchQuotaLimits(forceRefresh = false): Promise<QuotaLimitResponse | null> {
    // 先尝试获取缓存
    const cached = this.getCachedQuotaLimits();
    if (cached && !forceRefresh) {
      return cached;
    }

    // 网络请求
    const result = await this.makeRequest<QuotaLimitResponse>(this.getQuotaLimitUrl());

    // 请求成功，更新缓存
    if (result !== null) {
      if (this.cacheEnabled) {
        this.cache.set(`quota_limits`, result, 2 * 60 * 1000);
      }
      return result;
    }

    // 请求失败，返回缓存
    return cached;
  }

  /**
   * Fetch model usage with time window and optional caching
   * 失败时返回缓存数据或默认值
   */
  async fetchModelUsage(
    range: UsageRange = "today",
    forceRefresh = false,
  ): Promise<UsageResponse | null> {
    // 先尝试获取缓存
    const cached = this.getCachedModelUsage(range);
    if (cached && !forceRefresh) {
      return cached;
    }

    // 网络请求
    const result = await this.makeRequest<UsageResponse>(this.getModelUsageUrl(range));

    // 请求成功，更新缓存
    if (result !== null) {
      if (this.cacheEnabled) {
        const cacheKey = `model_usage_${range}`;
        this.cache.set(cacheKey, result, this.getCacheTTLForRange(range));
      }
      return result;
    }

    // 请求失败，返回缓存
    return cached;
  }

  /**
   * Fetch model usage by custom time range (no caching)
   */
  async fetchModelUsageByTimeRange(startTime: string, endTime: string): Promise<UsageResponse | null> {
    const baseUrl = this.getMonitorBaseUrl();
    const url = `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
    return this.makeRequest<UsageResponse>(url);
  }

  /**
   * Fetch tool usage with time window and optional caching
   * 失败时返回缓存数据或默认值
   */
  async fetchToolUsage(
    range: UsageRange = "today",
    forceRefresh = false,
  ): Promise<UsageResponse | null> {
    // 先尝试获取缓存
    const cached = this.getCachedToolUsage(range);
    if (cached && !forceRefresh) {
      return cached;
    }

    // 网络请求
    const result = await this.makeRequest<UsageResponse>(this.getToolUsageUrl(range));

    // 请求成功，更新缓存
    if (result !== null) {
      if (this.cacheEnabled) {
        const cacheKey = `tool_usage_${range}`;
        this.cache.set(cacheKey, result, this.getCacheTTLForRange(range));
      }
      return result;
    }

    // 请求失败，返回缓存
    return cached;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache TTL based on time range
   */
  private getCacheTTLForRange(range: UsageRange): number {
    switch (range) {
      case "today":
        return 5 * 60 * 1000; // 5 minutes
      case "last7Days":
        return 15 * 60 * 1000; // 15 minutes
      case "last30Days":
        return 30 * 60 * 1000; // 30 minutes
      default:
        return 5 * 60 * 1000;
    }
  }

  /**
   * Get base URL for monitoring API
   * Handles different URL formats:
   * - https://api.z.ai/api/anthropic -> https://api.z.ai
   * - https://api.z.ai -> https://api.z.ai
   * - https://api.z.ai/api -> https://api.z.ai
   */
  private getMonitorBaseUrl(): string {
    const parsedBaseUrl = new URL(this.config.baseUrl);
    const hostname = parsedBaseUrl.hostname;
    const isZai = hostname.includes("api.z.ai");
    const isZhipu =
      hostname.includes("open.bigmodel.cn") ||
      hostname.includes("dev.bigmodel.cn");

    if (!isZai && !isZhipu) {
      throw new Error(
        `Unsupported base URL: ${this.config.baseUrl}. Expected api.z.ai, open.bigmodel.cn, or dev.bigmodel.cn.`,
      );
    }

    return parsedBaseUrl.origin;
  }

  /**
   * Get quota limit URL
   */
  private getQuotaLimitUrl(): string {
    const baseUrl = this.getMonitorBaseUrl();
    return `${baseUrl}/api/monitor/usage/quota/limit`;
  }

  /**
   * Get model usage URL with time window params
   */
  private getModelUsageUrl(range: UsageRange): string {
    const baseUrl = this.getMonitorBaseUrl();
    const { startTime, endTime } = getTimeWindowParams(range);
    return `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
  }

  /**
   * Get tool usage URL with time window params
   */
  private getToolUsageUrl(range: UsageRange): string {
    const baseUrl = this.getMonitorBaseUrl();
    const { startTime, endTime } = getTimeWindowParams(range);
    return `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
  }

  /**
   * Make HTTPS request to GLM API
   * 失败时返回 null，不抛出错误
   */
  private async makeRequest<T>(url: string): Promise<T | null> {
    return new Promise((resolve) => {
      const parsedUrl = new URL(url);

      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: {
          Authorization: this.config.authToken,
          "Accept-Language": "en-US,en",
          "Content-Type": "application/json",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            const userFriendlyError = this.getUserFriendlyError(
              res.statusCode,
              data,
            );
            this.isOnline = false;
            this.lastNetworkError = userFriendlyError;
            return resolve(null);
          }
          try {
            this.isOnline = true;
            this.lastNetworkError = null;
            resolve(JSON.parse(data));
          } catch (e) {
            this.isOnline = false;
            this.lastNetworkError = "无法解析服务器响应";
            resolve(null);
          }
        });
      });

      req.on("error", (error) => {
        this.isOnline = false;
        this.lastNetworkError = `网络请求失败: ${error.message}`;
        resolve(null);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        this.isOnline = false;
        this.lastNetworkError = "请求超时";
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * 从缓存获取配额限制数据
   */
  getCachedQuotaLimits(): QuotaLimitResponse | null {
    const cacheKey = `quota_limits`;
    return this.cache.get<QuotaLimitResponse>(cacheKey);
  }

  /**
   * 从缓存获取模型使用数据
   */
  getCachedModelUsage(range: UsageRange): UsageResponse | null {
    const cacheKey = `model_usage_${range}`;
    return this.cache.get<UsageResponse>(cacheKey);
  }

  /**
   * 从缓存获取工具使用数据
   */
  getCachedToolUsage(range: UsageRange): UsageResponse | null {
    const cacheKey = `tool_usage_${range}`;
    return this.cache.get<UsageResponse>(cacheKey);
  }

  /**
   * 检查是否有可用的缓存数据
   */
  hasCachedData(range: UsageRange = "today"): boolean {
    return (
      this.getCachedQuotaLimits() !== null ||
      this.getCachedModelUsage(range) !== null ||
      this.getCachedToolUsage(range) !== null
    );
  }

  /**
   * Parse complete usage data including quota limits, model usage, and tool usage
   */
  parseCompleteUsageData(
    quotaLimits: unknown | null,
    modelUsage: UsageResponse | null,
    toolUsage: UsageResponse | null,
  ): QuotaSummary {
    const baseSummary = this.parseQuotaSummary(quotaLimits);
    const modelUsageDetails = this.extractModelUsageDetails(modelUsage ?? undefined);

    // Parse model usage data
    const consumedTokens = modelUsageDetails?.totalUsage?.totalTokensUsage;

    // Parse tool usage data
    const toolUsageDetails = this.extractToolUsageDetails(toolUsage ?? undefined);
    const mcpToolCalls = this.extractMcpToolCalls(toolUsageDetails);

    // 提取模型时序数据用于折线图
    const modelTimeSeries = this.extractModelTimeSeries(modelUsage ?? undefined);

    return {
      ...baseSummary,
      consumedTokens,
      modelUsageDetails,
      mcpToolCalls,
      toolUsageDetails,
      modelTimeSeries,
    };
  }

  /**
   * 提取模型 token 用量时序数据
   */
  private extractModelTimeSeries(
    modelUsage: UsageResponse | undefined,
  ): ModelTimeSeries | undefined {
    if (!modelUsage?.data || typeof modelUsage.data !== "object") {
      return undefined;
    }
    const d = modelUsage.data as Record<string, unknown>;
    const xTime = Array.isArray(d.x_time)
      ? d.x_time.map((t: unknown) => String(t))
      : undefined;
    if (!xTime || xTime.length === 0) return undefined;

    const totalTokensUsage = Array.isArray(d.tokensUsage)
      ? d.tokensUsage.map((v: unknown) => Number(v) || 0)
      : new Array(xTime.length).fill(0);

    const granularity =
      d.granularity === "hourly" || d.granularity === "daily"
        ? d.granularity
        : "daily";

    const models: ModelTimeSeriesItem[] = [];
    if (Array.isArray(d.modelDataList)) {
      for (const m of d.modelDataList) {
        if (!m || typeof m !== "object") continue;
        const item = m as Record<string, unknown>;
        const tokensUsage = Array.isArray(item.tokensUsage)
          ? item.tokensUsage.map((v: unknown) => Number(v) || 0)
          : [];
        models.push({
          modelName: String(item.modelName ?? ""),
          tokensUsage,
          totalTokens: Number(item.totalTokens ?? 0),
        });
      }
    }

    return { xTime, granularity, totalTokensUsage, models };
  }

  /**
   * Extract model usage details from response
   */
  extractModelUsageDetails(
    modelUsage: UsageResponse | undefined,
  ): ModelUsageData | undefined {
    if (!modelUsage || !modelUsage.data) {
      return undefined;
    }

    if (typeof modelUsage.data !== "object") {
      return undefined;
    }

    const wrapper = modelUsage.data as Record<string, unknown>;
    if (!wrapper.totalUsage || typeof wrapper.totalUsage !== "object") {
      return undefined;
    }

    const totalUsage = wrapper.totalUsage as Record<string, unknown>;
    const modelSummaryList = Array.isArray(totalUsage.modelSummaryList)
      ? totalUsage.modelSummaryList
          .filter((item): item is ModelSummaryItem =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => ({
            modelName: String(item.modelName ?? ""),
            totalTokens: Number(item.totalTokens ?? 0),
            sortOrder: Number(item.sortOrder ?? 0),
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined;

    return {
      totalUsage: {
        totalModelCallCount: Number(totalUsage.totalModelCallCount ?? 0),
        totalTokensUsage: Number(totalUsage.totalTokensUsage ?? 0),
        modelSummaryList,
      },
    };
  }

  /**
   * Extract tool usage details from response
   */
  private extractToolUsageDetails(
    toolUsage: UsageResponse | undefined,
  ): ToolUsageData | undefined {
    if (!toolUsage || !toolUsage.data) {
      return undefined;
    }

    if (typeof toolUsage.data !== "object") {
      return undefined;
    }

    const wrapper = toolUsage.data as Record<string, unknown>;
    if (!wrapper.totalUsage || typeof wrapper.totalUsage !== "object") {
      return undefined;
    }

    const totalUsage = wrapper.totalUsage as Record<string, unknown>;
    const toolDetails = Array.isArray(totalUsage.toolDetails)
      ? totalUsage.toolDetails
          .filter((item): item is ToolDetailItem =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => ({
            modelName: String(item.modelName ?? ""),
            totalUsageCount: Number(item.totalUsageCount ?? 0),
          }))
      : undefined;

    const toolSummaryList = Array.isArray(totalUsage.toolSummaryList)
      ? totalUsage.toolSummaryList
          .filter((item): item is ToolSummaryItem =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => ({
            toolCode: String(item.toolCode ?? ""),
            toolName: String(item.toolName ?? ""),
            totalUsageCount: Number(item.totalUsageCount ?? 0),
            sortOrder: Number(item.sortOrder ?? 0),
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined;

    return {
      totalUsage: {
        totalNetworkSearchCount: Number(totalUsage.totalNetworkSearchCount ?? 0),
        totalWebReadMcpCount: Number(totalUsage.totalWebReadMcpCount ?? 0),
        totalZreadMcpCount: Number(totalUsage.totalZreadMcpCount ?? 0),
        totalSearchMcpCount: Number(totalUsage.totalSearchMcpCount ?? 0),
        toolDetails,
        toolSummaryList,
      },
    };
  }

  /**
   * Extract MCP tool calls from tool usage details
   */
  private extractMcpToolCalls(
    toolUsage?: ToolUsageData,
  ): QuotaSummary["mcpToolCalls"] {
    const totalUsage = toolUsage?.totalUsage;
    if (!totalUsage) {
      return undefined;
    }

    return {
      totalNetworkSearchCount: totalUsage.totalNetworkSearchCount ?? 0,
      totalWebReadMcpCount: totalUsage.totalWebReadMcpCount ?? 0,
      totalZreadMcpCount: totalUsage.totalZreadMcpCount ?? 0,
      totalSearchMcpCount: totalUsage.totalSearchMcpCount ?? 0,
    };
  }

  /**
   * Parse quota summary for display
   * 根据API文档注释解析数据：
   * - TOKENS_LIMIT: unit=3表示百万(M) tokens, number=5表示5M, percentage=18%
   * - TIME_LIMIT: currentValue=44, usage=100, remaining=56, percentage=44%
   */
  parseQuotaSummary(response: unknown): QuotaSummary {
    // Handle wrapped response structure: { code: 200, data: { limits: [...] } }
    let actualResponse: QuotaLimitResponse;
    if (response && typeof response === "object") {
      const wrapper = response as Record<string, unknown>;
      if (wrapper.data && typeof wrapper.data === "object") {
        actualResponse = wrapper.data as QuotaLimitResponse;
      } else {
        actualResponse = response as QuotaLimitResponse;
      }
    } else {
      return {
        tokenUsage: { percentage: 0, used: 0, total: 0 },
        mcpUsage: { percentage: 0, used: 0, total: 0 },
        monthlyResetAt: getNextMonthlyResetTime(),
      };
    }

    if (
      !actualResponse ||
      !actualResponse.limits ||
      !Array.isArray(actualResponse.limits)
    ) {
      return {
        tokenUsage: { percentage: 0, used: 0, total: 0 },
        mcpUsage: { percentage: 0, used: 0, total: 0 },
        monthlyResetAt: getNextMonthlyResetTime(),
      };
    }

    const limits = actualResponse.limits;

    // ========== Parse all limits into QuotaItem[] ==========
    const quotaItems: QuotaItem[] = [];
    let tokenLimitIndex = 0;
    for (const limit of limits) {
      const percentage = Math.max(0, Math.min(100, this.toNumber(limit.percentage)));
      const resetAt = this.extractResetTimeFromLimit(limit);

      if (limit.type === "TOKENS_LIMIT") {
        // Multiple TOKENS_LIMIT entries: first = 5小时, second = 每周
        const label = tokenLimitIndex === 0 ? "5小时" : "每周";
        tokenLimitIndex++;
        quotaItems.push({
          type: "TOKENS_LIMIT",
          label,
          percentage,
          used: Math.max(0, percentage),
          total: 100,
          resetAt,
        });
      } else if (limit.type === "TIME_LIMIT") {
        const currentValue = this.toNumber(limit.currentValue);
        const totalUsage = this.toNumber(limit.usage);
        quotaItems.push({
          type: "TIME_LIMIT",
          label: "每月",
          percentage,
          used: Math.max(0, currentValue),
          total: Math.max(0, totalUsage),
          resetAt,
        });
      }
    }

    // ========== Backward-compatible first-item extraction ==========
    const tokenLimit = limits.find((l) => l.type === "TOKENS_LIMIT");
    const timeLimit = limits.find((l) => l.type === "TIME_LIMIT");

    let tokenPercentage = 0;
    let tokenTotal = 100;
    if (tokenLimit) {
      tokenPercentage = this.toNumber(tokenLimit.percentage);
    }

    let mcpPercentage = 0;
    let mcpUsed = 0;
    let mcpTotal = 0;
    if (timeLimit) {
      mcpPercentage = this.toNumber(timeLimit.percentage);
      mcpUsed = this.toNumber(timeLimit.currentValue);
      mcpTotal = this.toNumber(timeLimit.usage);
    }

    const tokenResetAt = this.extractTokenResetTime(tokenLimit);
    const mcpResetAt = this.extractMcpResetTime(timeLimit);

    return {
      tokenUsage: {
        percentage: Math.max(0, Math.min(100, tokenPercentage)),
        used: Math.max(0, tokenPercentage),
        total: Math.max(0, tokenTotal),
      },
      mcpUsage: {
        percentage: Math.max(0, Math.min(100, mcpPercentage)),
        used: Math.max(0, mcpUsed),
        total: Math.max(0, mcpTotal),
      },
      tokenResetAt,
      mcpResetAt,
      monthlyResetAt: mcpResetAt,
      level: actualResponse.level || undefined,
      quotaItems,
    };
  }

  async fetchDetailedUsage(range: UsageRange): Promise<DetailedUsageSnapshot | null> {
    const data = await this.fetchUsageByRange(range);

    // 如果全部失败，返回 null
    if (!data.quotaLimits && !data.modelUsage && !data.toolUsage) {
      return null;
    }

    const summary = this.parseQuotaSummary(data.quotaLimits);

    return {
      range,
      rangeLabel: getUsageRangeLabel(range),
      summary,
      modelUsage: this.aggregateUsage(data.modelUsage, "model"),
      toolUsage: this.aggregateUsage(data.toolUsage, "tool"),
      fetchedAt: new Date().toISOString(),
    };
  }

  private aggregateUsage(
    response: UsageResponse | null,
    field: "model" | "tool",
  ): UsageMetricSummary[] {
    const usageMap = new Map<string, UsageMetricSummary>();
    const entries = this.normalizeUsageEntries(response?.data);

    for (const item of entries) {
      const name = (field === "model" ? item.model : item.tool) || "Unknown";
      const current = usageMap.get(name) ?? { name, tokens: 0, requests: 0 };
      current.tokens += item.tokens ?? 0;
      current.requests += item.requests ?? 0;
      usageMap.set(name, current);
    }

    return Array.from(usageMap.values()).sort((left, right) => {
      if (right.tokens !== left.tokens) {
        return right.tokens - left.tokens;
      }

      if (right.requests !== left.requests) {
        return right.requests - left.requests;
      }

      return left.name.localeCompare(right.name);
    });
  }

  private extractMonthlyResetAt(response: QuotaLimitResponse): string {
    for (const limit of response?.limits ?? []) {
      const extracted = this.findResetTime(limit);
      if (extracted) {
        return extracted;
      }
    }

    return getNextMonthlyResetTime();
  }

  /**
   * Extract Token reset time (hourly reset)
   */
  private extractTokenResetTime(tokenLimit: QuotaLimit | undefined): string {
    if (tokenLimit?.nextResetTime) {
      const timestamp = this.toNumber(tokenLimit.nextResetTime);
      if (timestamp > 0) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    return getNextMonthlyResetTime();
  }

  /**
   * Extract MCP reset time (monthly reset)
   */
  private extractMcpResetTime(timeLimit: QuotaLimit | undefined): string {
    if (timeLimit?.nextResetTime) {
      const timestamp = this.toNumber(timeLimit.nextResetTime);
      if (timestamp > 0) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    return getNextMonthlyResetTime();
  }

  /**
   * Extract monthly reset time from limits
   * 优先使用 TIME_LIMIT 的 nextResetTime（月度重置），其次是 TOKENS_LIMIT
   */
  private extractMonthlyResetTime(
    tokenLimit: QuotaLimit | undefined,
    timeLimit: QuotaLimit | undefined,
  ): string {
    // 优先使用 TIME_LIMIT 的 nextResetTime（月度重置）
    if (timeLimit?.nextResetTime) {
      const timestamp = this.toNumber(timeLimit.nextResetTime);
      if (timestamp > 0) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    // 其次使用 TOKENS_LIMIT 的 nextResetTime（通常是小时级别的重置）
    if (tokenLimit?.nextResetTime) {
      const timestamp = this.toNumber(tokenLimit.nextResetTime);
      if (timestamp > 0) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    return getNextMonthlyResetTime();
  }

  private findResetTime(limit: QuotaLimit): string | null {
    // First check for nextResetTime field (timestamp in milliseconds)
    if (limit.nextResetTime) {
      const timestamp = this.toNumber(limit.nextResetTime);
      if (timestamp > 0) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    const details = limit.usageDetails;
    if (!details || typeof details !== "object") {
      return null;
    }

    // Handle if details is an array (as in the API response)
    if (Array.isArray(details)) {
      return null;
    }

    const candidateKeys = [
      "resetAt",
      "resetTime",
      "resetDate",
      "nextResetAt",
      "monthlyResetAt",
      "expireAt",
      "expiresAt",
    ];

    for (const key of candidateKeys) {
      const value = (details as Record<string, unknown>)[key];
      const parsed = this.normalizeDateValue(value);
      if (parsed) {
        return parsed;
      }
    }

    for (const value of Object.values(details)) {
      const parsed = this.normalizeDateValue(value);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private normalizeDateValue(value: unknown): string | null {
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    return null;
  }

  private normalizeUsageEntries(data: unknown): UsageResponseItem[] {
    const collected: UsageResponseItem[] = [];
    this.collectUsageEntries(data, collected);
    return collected;
  }

  private collectUsageEntries(
    input: unknown,
    collected: UsageResponseItem[],
  ): void {
    if (!input) {
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        this.collectUsageEntries(item, collected);
      }
      return;
    }

    if (typeof input !== "object") {
      return;
    }

    if (this.isUsageItem(input)) {
      collected.push(this.toUsageItem(input));
      return;
    }

    for (const value of Object.values(input)) {
      this.collectUsageEntries(value, collected);
    }
  }

  private isUsageItem(value: object): boolean {
    const candidate = value as Record<string, unknown>;
    const hasMetric =
      typeof candidate.tokens === "number" ||
      typeof candidate.tokens === "string" ||
      typeof candidate.requests === "number" ||
      typeof candidate.requests === "string";
    const hasName =
      typeof candidate.model === "string" ||
      typeof candidate.tool === "string" ||
      typeof candidate.name === "string";

    return hasMetric || hasName;
  }

  private toUsageItem(value: object): UsageResponseItem {
    const candidate = value as Record<string, unknown>;
    const name =
      typeof candidate.name === "string" ? candidate.name : undefined;

    return {
      timestamp:
        typeof candidate.timestamp === "string" ? candidate.timestamp : "",
      model: typeof candidate.model === "string" ? candidate.model : name,
      tool: typeof candidate.tool === "string" ? candidate.tool : name,
      tokens: this.toNumber(candidate.tokens),
      requests: this.toNumber(candidate.requests),
    };
  }

  private extractResetTimeFromLimit(limit: QuotaLimit | undefined): string | undefined {
    if (!limit?.nextResetTime) return undefined;
    const timestamp = this.toNumber(limit.nextResetTime);
    if (timestamp <= 0) return undefined;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  private getResetLabel(resetAtIso: string): string {
    const resetDate = new Date(resetAtIso);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return "5小时";

    const diffHr = diffMs / 3600000;
    if (diffHr <= 6) return "5小时";
    const diffDay = diffHr / 24;
    if (diffDay <= 8) return "每周";
    return "每月";
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  /**
   * Convert HTTP error to user-friendly message
   */
  private getUserFriendlyError(statusCode: number | undefined, data: string): string {
    const errorMessages: Record<number, string> = {
      400: "请求参数错误，请检查配置",
      401: "凭证无效或已过期，请检查 API Token",
      403: "没有权限访问该资源",
      404: "API 端点不存在，请检查 Base URL 配置",
      429: "请求过于频繁，请稍后再试",
      500: "服务器内部错误，请稍后重试",
      502: "网关错误，服务器可能正在维护",
      503: "服务暂时不可用，请稍后重试",
    };

    if (statusCode && errorMessages[statusCode]) {
      return errorMessages[statusCode];
    }

    // Try to parse error message from response
    try {
      const parsed = JSON.parse(data);
      if (parsed.message) {
        return `请求失败: ${parsed.message}`;
      }
      if (parsed.error) {
        return `请求失败: ${parsed.error}`;
      }
    } catch {
      // Ignore parse error
    }

    if (statusCode) {
      return `请求失败 (HTTP ${statusCode})，请稍后重试`;
    }

    return "请求失败，请检查网络连接后重试";
  }

  private extractNumericField(obj: QuotaLimit, fieldNames: string[]): number {
    for (const field of fieldNames) {
      const value = (obj as unknown as Record<string, unknown>)[field];
      if (value !== undefined && value !== null) {
        const num = this.toNumber(value);
        if (num > 0) {
          return num;
        }
      }
    }
    return 0;
  }

}

type UsageResponseItem = {
  timestamp: string;
  model?: string;
  tool?: string;
  tokens: number;
  requests: number;
};
