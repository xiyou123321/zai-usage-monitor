import * as vscode from "vscode";
import { QuotaSummary, UsageRange } from "../types/api";
import { getDominantPercentage, getWeeklyTokenItem } from "../util/quota";
import { getUsageRangeLabel } from "../util/timeWindow";

/**
 * Status bar display mode
 */
export type StatusBarMode = "compact" | "detailed" | "minimal";

/**
 * Manages VS Code status bar display for ZAI usage information
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private currentSummary: QuotaSummary | null = null;
  private currentRange: UsageRange = "today";
  private mode: StatusBarMode = "detailed";
  private isLoading = false;
  private error: string | null = null;
  private isOffline = false;

  constructor(mode: StatusBarMode = "detailed") {
    this.mode = mode;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      10,
    );
    this.statusBarItem.tooltip = this.createTooltipMarkdown(
      "ZAI Usage Monitor",
      "点击打开面板",
    );
    this.statusBarItem.command = "glmUsage.showUsage";
    this.statusBarItem.show();
  }

  /**
   * Update status bar with usage summary
   */
  update(summary: QuotaSummary, range: UsageRange = "today"): void {
    this.currentSummary = summary;
    this.currentRange = range;
    this.error = null;
    this.isLoading = false;
    this.isOffline = false;
    this.render();
  }

  /**
   * Show loading state
   */
  showLoading(): void {
    this.isLoading = true;
    this.render();
  }

  /**
   * Hide loading state
   */
  hideLoading(): void {
    this.isLoading = false;
    this.render();
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    this.error = message;
    this.isLoading = false;
    this.render();
  }

  /**
   * Show offline state - 显示网络离线状态
   */
  showOffline(): void {
    this.isOffline = true;
    this.error = null;
    this.isLoading = false;
    this.render();
  }

  /**
   * Hide offline state
   */
  hideOffline(): void {
    this.isOffline = false;
    this.render();
  }

  /**
   * Set display mode
   */
  setMode(mode: StatusBarMode): void {
    this.mode = mode;
    this.render();
  }

  /**
   * Get current mode
   */
  getMode(): StatusBarMode {
    return this.mode;
  }

  /**
   * Clear status bar
   */
  clear(): void {
    this.currentSummary = null;
    this.error = null;
    this.isLoading = false;
    this.isOffline = false;
    this.statusBarItem.text = "$(circle-large-outline) ZAI";
    this.statusBarItem.tooltip = this.createTooltipMarkdown(
      "ZAI Usage Monitor",
      "未配置凭证",
    );
    this.statusBarItem.color = undefined;
  }

  /**
   * Show no credentials state - passive notification
   */
  showNoCredentials(): void {
    this.currentSummary = null;
    this.error = null;
    this.isLoading = false;
    this.isOffline = false;
    this.statusBarItem.text = "$(key) ZAI 未配置";
    this.statusBarItem.tooltip = this.createTooltipMarkdown(
      "ZAI Usage Monitor",
      "点击打开面板",
      [
        "Claude Code / 环境变量 / 手动配置",
      ],
    );
    this.statusBarItem.color = new vscode.ThemeColor("descriptionForeground");
    this.statusBarItem.command = "glmUsage.showUsage";
  }

  /**
   * Get status bar color based on usage percentage
   */
  private getColor(): vscode.ThemeColor | undefined {
    if (this.isOffline) {
      return new vscode.ThemeColor("descriptionForeground");
    }
    const percentage = getDominantPercentage(this.currentSummary);
    if (percentage >= 95) {
      return new vscode.ThemeColor("errorForeground");
    }
    if (percentage >= 80) {
      return new vscode.ThemeColor("warningForeground");
    }
    if (percentage >= 50) {
      return new vscode.ThemeColor("charts.yellow");
    }
    return undefined;
  }

  /**
   * Get icon based on state
   */
  private getIcon(): string {
    if (this.isOffline) return "$(circle-slash)";
    if (this.error) return "$(error)";
    if (this.isLoading) return "$(sync~spin)";
    return "$(pulse)";
  }

  /**
   * Get text content based on mode
   */
  private getText(): string {
    const icon = this.getIcon();
    const wp = getWeeklyTokenItem(this.currentSummary)?.percentage;

    if (this.isOffline) {
      if (this.currentSummary) {
        const tp = Math.round(this.currentSummary.tokenUsage.percentage);
        const mp = Math.round(this.currentSummary.mcpUsage.percentage);
        const w = wp !== undefined ? ` W${Math.round(wp)}%` : "";
        return `${icon} T${tp}%${w} M${mp}%`;
      }
      return `${icon} 离线`;
    }

    if (this.error) {
      return `${icon} 错误`;
    }

    if (this.isLoading) {
      return `${icon} ...`;
    }

    if (!this.currentSummary) {
      return `${icon} ZAI`;
    }

    const tp = Math.round(this.currentSummary.tokenUsage.percentage);
    const mp = Math.round(this.currentSummary.mcpUsage.percentage);

    switch (this.mode) {
      case "minimal":
        return `${icon} ${Math.max(tp, Math.round(wp ?? 0), mp)}%`;
      case "compact": {
        const w = wp !== undefined ? ` W${Math.round(wp)}%` : "";
        return `${icon} T${tp}%${w} M${mp}%`;
      }
      case "detailed":
      default: {
        const w = wp !== undefined ? ` · W${Math.round(wp)}%` : "";
        return `${icon} T${tp}%${w} · M${mp}%`;
      }
    }
  }

  /**
   * Get tooltip content
   */
  private getTooltip(): vscode.MarkdownString {
    if (this.isOffline) {
      if (this.currentSummary) {
        const { tokenUsage, mcpUsage, tokenResetAt, mcpResetAt } =
          this.currentSummary;
        const tokenResetTime = tokenResetAt
          ? new Date(tokenResetAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
          : "--";
        const mcpResetTime = mcpResetAt
          ? new Date(mcpResetAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
          : "--";
        const totalTokens = this.currentSummary.consumedTokens ?? 0;
        const totalModelCalls = this.currentSummary.modelUsageDetails?.totalUsage?.totalModelCallCount ?? 0;
        const offlineLines = [
          `Token **${tokenUsage.percentage.toFixed(1)}%** · 重置 ${tokenResetTime}`,
        ];
        const offlineWeekly = this.formatWeeklyTooltipLine();
        if (offlineWeekly) offlineLines.push(offlineWeekly);
        offlineLines.push(
          `MCP **${mcpUsage.percentage.toFixed(1)}%** · 重置 ${mcpResetTime}`,
          "",
          `范围：${getUsageRangeLabel(this.currentRange)}`,
          `消耗 ${totalTokens > 0 ? this.formatTooltipTokens(totalTokens) : "--"} · 调用 ${totalModelCalls.toLocaleString("zh-CN")}`,
          "",
          "点击打开面板",
        );
        return this.createTooltipMarkdown(
          "ZAI Usage",
          "离线缓存",
          offlineLines,
          "warning",
        );
      }
      return this.createTooltipMarkdown("ZAI Usage", "离线 · 无缓存", ["点击打开面板"], "warning");
    }

    if (this.error) {
      return this.createTooltipMarkdown("ZAI Usage", `错误：${this.error}`, ["点击打开面板"], "warning");
    }

    if (this.isLoading) {
      return this.createTooltipMarkdown("ZAI Usage", "加载中...");
    }

    if (!this.currentSummary) {
      return this.createTooltipMarkdown("ZAI Usage", "未配置凭证", ["点击配置"]);
    }

    const { tokenUsage, mcpUsage, tokenResetAt, mcpResetAt } = this.currentSummary;
    const tokenResetTime = tokenResetAt
      ? new Date(tokenResetAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "--";
    const mcpResetTime = mcpResetAt
      ? new Date(mcpResetAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      : "--";

    const topModel = this.currentSummary.modelUsageDetails?.totalUsage?.modelSummaryList
      ?.slice().sort((a, b) => b.totalTokens - a.totalTokens)[0];
    const totalToolCalls =
      (this.currentSummary.mcpToolCalls?.totalNetworkSearchCount ?? 0) +
      (this.currentSummary.mcpToolCalls?.totalWebReadMcpCount ?? 0) +
      (this.currentSummary.mcpToolCalls?.totalZreadMcpCount ?? 0) +
      (this.currentSummary.mcpToolCalls?.totalSearchMcpCount ?? 0);

    const totalTokens = this.currentSummary.consumedTokens ?? 0;
    const totalModelCalls = this.currentSummary.modelUsageDetails?.totalUsage?.totalModelCallCount ?? 0;
    const avgTokPerCall = totalModelCalls > 0 ? Math.round(totalTokens / totalModelCalls) : 0;
    const modelCount = this.currentSummary.modelUsageDetails?.totalUsage?.modelSummaryList?.length ?? 0;
    const mcpCalls = this.currentSummary.mcpToolCalls;
    const topToolName = totalToolCalls > 0
      ? ["网络搜索", "网页阅读", "Z 阅读", "搜索 MCP"]
          .map((n, i) => ({ n, c: [
            mcpCalls?.totalNetworkSearchCount ?? 0,
            mcpCalls?.totalWebReadMcpCount ?? 0,
            mcpCalls?.totalZreadMcpCount ?? 0,
            mcpCalls?.totalSearchMcpCount ?? 0,
          ][i] }))
          .sort((a, b) => b.c - a.c)[0]?.n
      : "";

    const onlineLines = [
      `Token **${tokenUsage.percentage.toFixed(1)}%** · 重置 ${tokenResetTime}`,
    ];
    const onlineWeekly = this.formatWeeklyTooltipLine();
    if (onlineWeekly) onlineLines.push(onlineWeekly);
    onlineLines.push(
      `MCP **${mcpUsage.percentage.toFixed(1)}%** · 重置 ${mcpResetTime}`,
      "",
      `范围：${getUsageRangeLabel(this.currentRange)}`,
      `消耗 ${totalTokens > 0 ? this.formatTooltipTokens(totalTokens) : "--"} · 调用 ${totalModelCalls.toLocaleString("zh-CN")} · 平均 ${avgTokPerCall.toLocaleString("zh-CN")} tok/call`,
      `模型 ${modelCount} 个 · 工具 ${totalToolCalls.toLocaleString("zh-CN")}`,
      topModel ? `主力：${topModel.modelName} (${this.formatTooltipTokens(topModel.totalTokens)})` : "",
      topToolName ? `常用工具：${topToolName}` : "",
      "",
      "点击打开面板",
    );

    return this.createTooltipMarkdown(
      "ZAI Usage",
      this.getHealthLabel(getDominantPercentage(this.currentSummary)),
      onlineLines,
      getDominantPercentage(this.currentSummary) >= 80 ? "warning" : "info",
    );
  }

  /**
   * Render status bar
   */
  private render(): void {
    this.statusBarItem.text = this.getText();
    this.statusBarItem.tooltip = this.getTooltip();
    this.statusBarItem.color = this.getColor();
  }

  /**
   * Build the weekly token tooltip line, or null when no weekly limit exists.
   */
  private formatWeeklyTooltipLine(): string | null {
    const item = getWeeklyTokenItem(this.currentSummary);
    if (!item) return null;
    const resetTime = item.resetAt
      ? new Date(item.resetAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      : "--";
    return `每周 **${item.percentage.toFixed(1)}%** · 重置 ${resetTime}`;
  }

  private formatTooltipTokens(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toString();
  }

  private getHealthLabel(percentage: number): string {
    if (percentage >= 95) {
      return "高风险";
    }
    if (percentage >= 80) {
      return "需关注";
    }
    if (percentage >= 50) {
      return "正常偏高";
    }
    return "状态正常";
  }

  private createTooltipMarkdown(
    title: string,
    summary: string,
    lines: string[] = [],
    tone: "info" | "warning" = "info",
  ): vscode.MarkdownString {
    const icon = tone === "warning" ? "$(warning)" : "$(pulse)";
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = false;
    markdown.supportThemeIcons = true;
    markdown.appendMarkdown(`### ${icon} ${title}\n\n`);
    markdown.appendMarkdown(`${summary}\n\n`);

    if (lines.length > 0) {
      markdown.appendMarkdown(lines.join("  \n"));
    }

    return markdown;
  }

  /**
   * Dispose status bar
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
