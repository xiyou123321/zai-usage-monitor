import * as vscode from "vscode";
import { QuotaSummary, UsageRange } from "../types/api";
import { getUsageRangeLabel } from "../util/timeWindow";

// Apple system colors
const CHART_COLORS = [
  "#007AFF", // blue
  "#FF9500", // orange
  "#34C759", // green
  "#AF52DE", // purple
  "#FF2D55", // pink
  "#5AC8FA", // teal
  "#5856D6", // indigo
  "#FF3B30", // red
  "#8E8E93", // gray
  "#FFCC00", // yellow
];

/**
 * 管理详情面板，展示模型占比环形图 + 工具使用柱状图 + 丰富数据卡片
 */
export class UsagePanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentSummary: QuotaSummary | null = null;
  private currentRange: UsageRange = "today";
  private isLoading = false;
  private isOffline = false;

  constructor(private context: vscode.ExtensionContext) {}

  async show(
    summary: QuotaSummary | null,
    range: UsageRange = "today",
  ): Promise<void> {
    this.currentSummary = summary;
    this.currentRange = range;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.updateContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "glmUsagePanel",
      "ZAI 使用量",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "refresh":
            vscode.commands.executeCommand("glmUsage.refresh");
            break;
          case "changeRange":
            vscode.commands.executeCommand(
              "glmUsage.changeRange",
              message.range,
            );
            break;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    await this.updateContent();
  }

  async update(
    summary: QuotaSummary,
    range: UsageRange = "today",
  ): Promise<void> {
    this.currentSummary = summary;
    this.currentRange = range;
    this.isLoading = false;
    this.isOffline = summary.isOffline === true;
    if (!this.panel) return;
    await this.updateContent();
  }

  showLoading(): void {
    this.isLoading = true;
    this.isOffline = false;
    if (this.panel) {
      this.panel.webview.html = this.getLoadingHtml();
    }
  }

  showOffline(): void {
    this.isOffline = true;
    this.isLoading = false;
    if (this.panel) {
      this.panel.webview.html = this.getHtml();
    }
  }

  hideOffline(): void {
    this.isOffline = false;
    if (this.panel) {
      this.panel.webview.html = this.getHtml();
    }
  }

  private async updateContent(): Promise<void> {
    if (!this.panel) return;
    this.panel.webview.html = this.getHtml();
  }

  // ── 图表生成 ──────────────────────────────────────

  private generateDonutSvg(
    models: {
      name: string;
      tokens: number;
      color: string;
      percent: number;
    }[],
    centerValue: string,
    centerLabel: string,
  ): string {
    const radius = 68;
    const sw = 18;
    const C = 2 * Math.PI * radius;
    const total = models.reduce((s, m) => s + m.tokens, 0);
    if (total === 0) {
      return `<svg viewBox="0 0 200 200" class="donut-chart">
        <circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${sw}" opacity="0.15"/>
        <text x="100" y="96" text-anchor="middle" class="donut-value">--</text>
        <text x="100" y="116" text-anchor="middle" class="donut-label">${centerLabel}</text>
      </svg>`;
    }

    let cumOffset = 0;
    const segments = models
      .filter((m) => m.tokens > 0)
      .map((m) => {
        const arc = (m.tokens / total) * C;
        const s = `<circle cx="100" cy="100" r="${radius}" fill="none"
          stroke="${m.color}" stroke-width="${sw}"
          stroke-dasharray="${arc} ${C - arc}"
          stroke-dashoffset="${-cumOffset}"
          transform="rotate(-90 100 100)"
          class="donut-segment" data-model="${this.escapeHtml(m.name)}"/>`;
        cumOffset += arc;
        return s;
      })
      .join("\n");

    return `<svg viewBox="0 0 200 200" class="donut-chart">
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${sw}" opacity="0.08"/>
      ${segments}
      <text x="100" y="96" text-anchor="middle" class="donut-value">${centerValue}</text>
      <text x="100" y="116" text-anchor="middle" class="donut-label">${centerLabel}</text>
    </svg>`;
  }

  // ── 配额进度条渲染 ──

  private renderQuotaSection(summary: QuotaSummary): string {
    const items = summary.quotaItems;
    if (!items || items.length === 0) {
      // Fallback to old two-card layout
      const tokenPercent = Math.round(summary.tokenUsage.percentage);
      const mcpPercent = Math.round(summary.mcpUsage.percentage);
      const tokenResetTime = summary.tokenResetAt
        ? new Date(summary.tokenResetAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
        : "--";
      const mcpResetTime = summary.mcpResetAt
        ? new Date(summary.mcpResetAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        : "--";
      return `<div class="quota-section">
        <div class="quota-card">
          <div class="quota-card-header">
            <span class="quota-card-label"><span class="tag-dot" style="background:var(--apple-blue)"></span> Token 配额</span>
            <span class="quota-card-pct" style="color:${this.getProgressColor(tokenPercent)}">${tokenPercent}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(tokenPercent, 100)}%;background:${this.getProgressColor(tokenPercent)}"></div></div>
          <div class="quota-card-meta"><span>已用 ${tokenPercent}%</span><span>重置 ${tokenResetTime}</span></div>
        </div>
        <div class="quota-card">
          <div class="quota-card-header">
            <span class="quota-card-label"><span class="tag-dot" style="background:var(--apple-orange)"></span> MCP 配额</span>
            <span class="quota-card-pct" style="color:${this.getProgressColor(mcpPercent)}">${mcpPercent}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(mcpPercent, 100)}%;background:${this.getProgressColor(mcpPercent)}"></div></div>
          <div class="quota-card-meta"><span>已用 ${summary.mcpUsage.used} / ${summary.mcpUsage.total}</span><span>重置 ${mcpResetTime}</span></div>
        </div>
      </div>`;
    }

    // Dynamic: render all quota items
    const quotaColors = [
      "var(--apple-blue)", "var(--apple-orange)", "var(--apple-green)",
      "var(--apple-purple)", "var(--apple-pink)", "var(--apple-teal)",
    ];
    const tokenIcon = "var(--apple-blue)";
    const mcpIcon = "var(--apple-orange)";

    const cards = items.map((item, i) => {
      const pct = Math.round(item.percentage);
      const color = this.getProgressColor(pct);
      const dotColor = item.type === "TOKENS_LIMIT" ? tokenIcon : mcpIcon;
      const typePrefix = item.type === "TOKENS_LIMIT" ? "Token" : "MCP";
      const displayLabel = `${typePrefix} · ${item.label}`;
      const resetTime = item.resetAt
        ? new Date(item.resetAt).toLocaleString("zh-CN", {
            month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false,
          })
        : "--";
      const usedLabel = item.type === "TIME_LIMIT"
        ? `已用 ${item.used} / ${item.total}`
        : `已用 ${pct}%`;

      return `<div class="quota-card">
        <div class="quota-card-header">
          <span class="quota-card-label"><span class="tag-dot" style="background:${dotColor}"></span> ${this.escapeHtml(displayLabel)}</span>
          <span class="quota-card-pct" style="color:${color}">${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
        <div class="quota-card-meta"><span>${usedLabel}</span><span>重置 ${resetTime}</span></div>
      </div>`;
    }).join("\n");

    return `<div class="quota-section">${cards}</div>`;
  }

  // ── HTML 主体 ──────────────────────────────────────

  private getHtml(): string {
    if (!this.currentSummary) {
      return this.getLoadingHtml();
    }

    const summary = this.currentSummary;
    const { tokenUsage, mcpUsage } = summary;
    const tokenPercent = Math.round(tokenUsage.percentage);
    const mcpPercent = Math.round(mcpUsage.percentage);

    const tokenResetTime = summary.tokenResetAt
      ? new Date(summary.tokenResetAt).toLocaleString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "--";
    const mcpResetTime = summary.mcpResetAt
      ? new Date(summary.mcpResetAt).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "--";

    // ── 统计数据 ──
    const totalTokens = summary.consumedTokens ?? 0;
    const totalModelCalls =
      summary.modelUsageDetails?.totalUsage?.totalModelCallCount ?? 0;
    const avgTokensPerCall =
      totalModelCalls > 0 ? Math.round(totalTokens / totalModelCalls) : 0;

    const toolCalls = summary.mcpToolCalls;
    const totalToolCalls =
      (toolCalls?.totalNetworkSearchCount ?? 0) +
      (toolCalls?.totalWebReadMcpCount ?? 0) +
      (toolCalls?.totalZreadMcpCount ?? 0) +
      (toolCalls?.totalSearchMcpCount ?? 0);

    // ── 模型数据 ──
    const modelList = [
      ...(summary.modelUsageDetails?.totalUsage?.modelSummaryList ?? []),
    ].sort((a, b) => b.totalTokens - a.totalTokens);

    // Build color map: modelName → color (consistent across all charts)
    const modelColorMap = new Map<string, string>();
    modelList.forEach((m, i) => {
      modelColorMap.set(m.modelName, CHART_COLORS[i % CHART_COLORS.length]);
    });

    const donutData = modelList.map((m) => ({
      name: m.modelName,
      tokens: m.totalTokens,
      color: modelColorMap.get(m.modelName)!,
      percent: summary.consumedTokens
        ? Math.round((m.totalTokens / summary.consumedTokens) * 1000) / 10
        : 0,
    }));

    const totalConsumed = summary.consumedTokens
      ? this.formatTokenCount(summary.consumedTokens)
      : "--";

    const donutSvg = this.generateDonutSvg(
      donutData,
      totalConsumed,
      "Token 使用",
    );

    const legendItems = donutData
      .map(
        (d) => `
      <div class="legend-item clickable" data-model="${this.escapeHtml(d.name)}"
           onmouseenter="highlightModel('${this.escapeHtml(d.name)}')" onmouseleave="unhighlightModel()">
        <span class="legend-dot" style="background:${d.color}"></span>
        <span class="legend-name" title="${this.escapeHtml(d.name)}">${this.escapeHtml(d.name)}</span>
        <span class="legend-value">${this.formatTokenCount(d.tokens)}</span>
        <span class="legend-pct">${d.percent}%</span>
      </div>`,
      )
      .join("");

    // ── 工具数据 ──
    const toolItems = [
      { name: "网络搜索", code: "networkSearch", count: toolCalls?.totalNetworkSearchCount ?? 0, color: CHART_COLORS[2] },
      { name: "网页阅读", code: "webReadMcp", count: toolCalls?.totalWebReadMcpCount ?? 0, color: CHART_COLORS[3] },
      { name: "Z 阅读", code: "zreadMcp", count: toolCalls?.totalZreadMcpCount ?? 0, color: CHART_COLORS[1] },
      { name: "搜索 MCP", code: "searchMcp", count: toolCalls?.totalSearchMcpCount ?? 0, color: CHART_COLORS[0] },
    ];
    const maxTool = Math.max(...toolItems.map((t) => t.count), 1);

    const toolTags = toolItems
      .map((t) => `<div class="tool-tag"><span class="tag-dot" style="background:${t.color}"></span>${t.name}</div>`)
      .join("");

    const barRows = toolItems
      .map(
        (t) => `
      <div class="bar-row clickable" data-tool="${t.code}"
           onmouseenter="highlightTool('${t.code}')" onmouseleave="unhighlightTool()">
        <div class="bar-name">${t.name}</div>
        <div class="bar-track"><div class="bar-fill" data-tool-bar="${t.code}" style="width:${(t.count / maxTool) * 100}%;background:${t.color}"></div></div>
        <div class="bar-count">${t.count}</div>
      </div>`,
      )
      .join("");

    const countCards = toolItems
      .map(
        (t) => `
      <div class="count-card">
        <div class="count-num" style="color:${t.count > 0 ? t.color : "var(--muted)"}">${t.count}</div>
        <div class="count-label">${t.name}</div>
      </div>`,
      )
      .join("");

    // ── 工具详情表格 ──
    const toolSummaryList = summary.toolUsageDetails?.totalUsage?.toolSummaryList;
    const toolSummaryHtml = toolSummaryList?.length
      ? `<div class="detail-table-wrap">
          <table class="detail-table">
            <thead><tr><th>工具名称</th><th>调用次数</th><th>占比</th></tr></thead>
            <tbody>${toolSummaryList.map((t) => {
              const pct = totalToolCalls > 0 ? ((t.totalUsageCount / totalToolCalls) * 100).toFixed(1) : "0.0";
              return `<tr class="clickable"><td>${this.escapeHtml(t.toolName || t.toolCode)}</td><td class="td-num">${t.totalUsageCount.toLocaleString("zh-CN")}</td><td class="td-num">${pct}%</td></tr>`;
            }).join("")}</tbody>
          </table>
        </div>`
      : "";

    // ── 模型详细表格 ──
    const modelDetailHtml = modelList.length
      ? `<div class="detail-table-wrap" style="margin-top:12px">
          <table class="detail-table">
            <thead><tr><th>模型</th><th>Token 用量</th><th>占比</th></tr></thead>
            <tbody>${modelList.map((m) => {
              const pct = totalTokens > 0 ? ((m.totalTokens / totalTokens) * 100).toFixed(1) : "0.0";
              const color = modelColorMap.get(m.modelName) ?? "var(--muted)";
              return `<tr class="clickable" data-model="${this.escapeHtml(m.modelName)}"
                onmouseenter="highlightModel('${this.escapeHtml(m.modelName)}')" onmouseleave="unhighlightModel()">
                <td class="td-model"><span class="td-dot" style="background:${color}"></span>${this.escapeHtml(m.modelName)}</td>
                <td class="td-num">${this.formatTokenCount(m.totalTokens)}</td>
                <td class="td-num">${pct}%</td></tr>`;
            }).join("")}</tbody>
          </table>
        </div>`
      : "";

    const topModel = modelList[0];
    const ranges: UsageRange[] = ["today", "last7Days", "last30Days"];
    const levelText = summary.level ? summary.level : "";
    const sourceLabels: Record<string, string> = { claude: "Claude Code", env: "环境变量", manual: "手动配置" };

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ZAI Usage</title>
<style>
  :root {
    --apple-blue: #007AFF;
    --apple-green: #34C759;
    --apple-orange: #FF9500;
    --apple-red: #FF3B30;
    --apple-purple: #AF52DE;
    --apple-pink: #FF2D55;
    --apple-teal: #5AC8FA;
    --apple-indigo: #5856D6;
    --apple-yellow: #FFCC00;
    --apple-gray: #8E8E93;
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --card-bg: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 60%, transparent);
    --card-bg-solid: var(--vscode-editor-inactiveSelectionBackground);
    --panel-bg: var(--vscode-editor-selectionBackground);
    --border: var(--vscode-panel-border, rgba(128,128,128,.12));
    --muted: var(--vscode-descriptionForeground);
    --radius: 12px;
    --radius-sm: 8px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",var(--vscode-font-family,sans-serif);
    color:var(--fg);background:var(--bg);
    font-size:12px;line-height:1.5;padding:20px;
    max-height:100vh;overflow-y:auto;
    -webkit-font-smoothing:antialiased;
  }

  /* 头部 */
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .title{font-size:17px;font-weight:700;letter-spacing:-.2px;display:flex;align-items:center;gap:8px}
  .level-badge{
    font-size:10px;font-weight:600;padding:2px 10px;border-radius:999px;
    background:color-mix(in srgb, var(--apple-blue) 12%, transparent);color:var(--apple-blue);
  }
  .header-right{display:flex;align-items:center;gap:8px}
  .tabs{display:flex;gap:0;background:var(--card-bg-solid);border-radius:var(--radius-sm);padding:2px;border:1px solid var(--border)}
  .tab{padding:5px 14px;border-radius:6px;cursor:pointer;color:var(--muted);font-size:11px;font-weight:500;transition:all .2s}
  .tab.active{background:var(--bg);color:var(--fg);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .tab:hover:not(.active){color:var(--fg)}
  .refresh-btn{
    border:none;border-radius:var(--radius-sm);padding:5px 16px;cursor:pointer;font-size:11px;font-weight:500;
    background:var(--card-bg-solid);color:var(--fg);border:1px solid var(--border);
    transition:all .15s;
  }
  .refresh-btn:hover{background:var(--panel-bg);border-color:var(--apple-blue)}

  /* 配额进度条 */
  .quota-section{display:flex;gap:12px;margin-bottom:16px}
  .quota-card{
    flex:1;padding:14px 16px;border-radius:var(--radius);background:var(--card-bg);
    border:1px solid var(--border);transition:border-color .2s;
  }
  .quota-card:hover{border-color:color-mix(in srgb, var(--apple-blue) 40%, var(--border))}
  .quota-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
  .quota-card-label{font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px}
  .quota-card-pct{font-size:20px;font-weight:700;letter-spacing:-.5px}
  .progress-track{height:5px;border-radius:3px;background:var(--panel-bg);overflow:hidden;margin-bottom:8px}
  .progress-fill{height:100%;border-radius:3px;transition:width .4s cubic-bezier(.4,0,.2,1)}
  .quota-card-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:10px}
  .offline-badge{
    padding:3px 12px;border-radius:999px;font-size:10px;font-weight:600;
    background:color-mix(in srgb, var(--apple-orange) 15%, transparent);color:var(--apple-orange);
  }

  /* 快速统计卡片 */
  .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
  .stat-card{
    padding:14px 10px;border-radius:var(--radius);background:var(--card-bg);
    border:1px solid var(--border);text-align:center;transition:all .2s;
  }
  .stat-card:hover{border-color:color-mix(in srgb, var(--apple-blue) 50%, var(--border));transform:translateY(-1px)}
  .stat-value{font-size:20px;font-weight:700;line-height:1.2;letter-spacing:-.5px}
  .stat-label{font-size:10px;color:var(--muted);margin-top:3px;font-weight:500}
  .stat-sub{font-size:9px;color:var(--muted);margin-top:1px}

  /* 主网格 */
  .main-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .card{
    background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:18px;
    display:flex;flex-direction:column;transition:border-color .2s;
  }
  .card:hover{border-color:color-mix(in srgb, var(--apple-blue) 30%, var(--border))}
  .card-title{font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px;letter-spacing:-.1px}
  .card-title-count{
    font-size:10px;font-weight:500;color:var(--apple-blue);
    background:color-mix(in srgb, var(--apple-blue) 10%, transparent);padding:2px 10px;border-radius:999px;
  }

  /* 环形图 */
  .chart-area{display:flex;justify-content:center;margin-bottom:14px}
  .donut-chart{width:180px;height:180px}
  .donut-segment{transition:opacity .15s, stroke-width .15s}
  .donut-segment.highlighted{stroke-width:24;opacity:1}
  .donut-segment.dimmed{opacity:.2}
  .donut-value{font-size:22px;font-weight:700;fill:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
  .donut-label{font-size:11px;fill:var(--muted);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}

  /* 图例 */
  .legend{display:flex;flex-direction:column;gap:6px}
  .legend-item{display:grid;grid-template-columns:8px 1fr auto auto;gap:6px;align-items:center;font-size:11px;padding:2px 4px;border-radius:4px}
  .legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .legend-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .legend-value{color:var(--muted);text-align:right;white-space:nowrap}
  .legend-pct{font-weight:600;text-align:right;min-width:36px}

  /* 可点击元素 */
  .clickable{cursor:pointer;transition:background .15s,opacity .15s}
  .clickable:hover{background:color-mix(in srgb, var(--apple-blue) 6%, transparent)}
  .clickable.highlighted{background:color-mix(in srgb, var(--apple-blue) 10%, transparent)}
  .clickable.dimmed{opacity:.3}
  .td-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:middle}

  /* 工具标签 */
  .tool-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
  .tool-tag{display:flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:500;background:var(--panel-bg)}
  .tag-dot{width:6px;height:6px;border-radius:50%}

  /* 柱状图 */
  .bar-chart{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
  .bar-row{display:grid;grid-template-columns:64px 1fr 36px;gap:8px;align-items:center;border-radius:4px;padding:2px 4px}
  .bar-name{font-size:11px;color:var(--muted);white-space:nowrap}
  .bar-track{height:16px;border-radius:var(--radius-sm);background:var(--panel-bg);overflow:hidden}
  .bar-fill{height:100%;border-radius:var(--radius-sm);min-width:2px;transition:width .3s cubic-bezier(.4,0,.2,1),opacity .15s}
  .bar-fill.dimmed{opacity:.2}
  .bar-count{font-size:13px;font-weight:700;text-align:right}

  /* 计数卡片 */
  .count-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .count-card{text-align:center;padding:10px 6px;border-radius:var(--radius-sm);background:var(--panel-bg)}
  .count-num{font-size:20px;font-weight:700}
  .count-label{font-size:10px;color:var(--muted);margin-top:2px}

  /* 详情表格 */
  .detail-table-wrap{overflow-x:auto}
  .detail-table{width:100%;border-collapse:collapse;font-size:11px}
  .detail-table th{text-align:left;padding:6px 8px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;letter-spacing:.3px}
  .detail-table td{padding:5px 8px;border-bottom:1px solid color-mix(in srgb, var(--border) 50%, transparent)}
  .detail-table tr.clickable:hover td{background:color-mix(in srgb, var(--apple-blue) 6%, transparent)}
  .td-num{text-align:right;font-variant-numeric:tabular-nums}
  .td-model{font-family:var(--vscode-editor-font-family,var(--vscode-font-family));max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* 页脚 */
  .footer{
    margin-top:16px;padding-top:12px;border-top:1px solid var(--border);
    display:flex;justify-content:space-between;align-items:center;
    color:var(--muted);font-size:10px;
  }

  @media(max-width:600px){
    .main-grid{grid-template-columns:1fr}
    .stats-grid{grid-template-columns:repeat(2,1fr)}
    .quota-section{flex-direction:column}
  }

  /* 折线图 */
  .trend-card{
    background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);
    padding:18px;margin-top:14px;
  }
  .trend-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .trend-title{font-size:13px;font-weight:700;letter-spacing:-.1px}
  .trend-legend{display:flex;gap:12px;flex-wrap:wrap}
  .trend-legend-item{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);padding:2px 6px;border-radius:4px}
  .trend-legend-dot{width:10px;height:3px;border-radius:2px}
  .trend-svg{width:100%;height:auto;display:block}
  .trend-svg text{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}
  .trend-line{transition:opacity .15s;cursor:pointer}
  .trend-line.dimmed{opacity:.12}
  .trend-line.highlighted{stroke-width:3}
</style>
</head>
<body>

<div class="header">
  <div class="title">ZAI 套餐${levelText ? ` <span class="level-badge">${this.escapeHtml(levelText)}</span>` : ""}</div>
  <div class="header-right">
    <div class="tabs">
      ${ranges.map((r) => `<div class="tab ${r === this.currentRange ? "active" : ""}" onclick="changeRange('${r}')">${getUsageRangeLabel(r)}</div>`).join("")}
    </div>
    <button class="refresh-btn" onclick="refresh()">刷新</button>
  </div>
</div>

${this.isOffline ? '<div style="margin-bottom:12px"><span class="offline-badge">⚡ 离线缓存</span></div>' : ""}

<!-- 配额进度条 -->
${this.renderQuotaSection(summary)}

<!-- 快速统计 -->
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value" style="color:var(--apple-blue)">${this.formatTokenCount(totalTokens)}</div>
    <div class="stat-label">Token 消耗</div>
    <div class="stat-sub">${totalTokens.toLocaleString("zh-CN")} tokens</div>
  </div>
  <div class="stat-card">
    <div class="stat-value" style="color:var(--apple-green)">${totalModelCalls.toLocaleString("zh-CN")}</div>
    <div class="stat-label">模型调用</div>
    <div class="stat-sub">avg ${avgTokensPerCall.toLocaleString("zh-CN")} tok/call</div>
  </div>
  <div class="stat-card">
    <div class="stat-value" style="color:var(--apple-orange)">${totalToolCalls.toLocaleString("zh-CN")}</div>
    <div class="stat-label">工具调用</div>
    <div class="stat-sub">${totalToolCalls > 0 ? ((totalToolCalls / Math.max(totalModelCalls, 1)) * 100).toFixed(0) + "% of calls" : "无工具调用"}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value" style="color:var(--apple-purple);font-size:14px">${topModel ? this.escapeHtml(topModel.modelName) : "--"}</div>
    <div class="stat-label">主力模型</div>
    <div class="stat-sub">${topModel ? this.formatTokenCount(topModel.totalTokens) + " tokens" : ""}</div>
  </div>
</div>

<div class="main-grid">
  <div class="card">
    <div class="card-title">模型使用占比 <span class="card-title-count">${modelList.length} 个模型</span></div>
    <div class="chart-area">${donutSvg}</div>
    <div class="legend">${legendItems || '<div style="color:var(--muted)">暂无模型数据</div>'}</div>
    ${modelDetailHtml}
  </div>

  <div class="card">
    <div class="card-title">工具使用统计 <span class="card-title-count">${totalToolCalls} 次调用</span></div>
    <div class="tool-tags">${toolTags}</div>
    <div class="bar-chart">${barRows}</div>
    <div class="count-grid">${countCards}</div>
    ${toolSummaryHtml}
  </div>
</div>

${this.generateLineChartSection(summary, modelColorMap)}

<div class="footer">
  <span>${this.getRefreshInfoHtml(summary)}</span>
  <span>${summary.credentialSource ? `来源：${sourceLabels[summary.credentialSource] || summary.credentialSource}` : ""}</span>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function refresh(){vscode.postMessage({type:'refresh'})}
  function changeRange(r){vscode.postMessage({type:'changeRange',range:r})}

  function highlightModel(name){
    document.querySelectorAll('.donut-segment').forEach(el=>{
      if(el.dataset.model===name) el.classList.add('highlighted');
      else el.classList.add('dimmed');
    });
    document.querySelectorAll('.trend-line').forEach(el=>{
      if(el.dataset.model===name){el.classList.add('highlighted');el.classList.remove('dimmed');}
      else{el.classList.add('dimmed');el.classList.remove('highlighted');}
    });
    document.querySelectorAll('.legend-item').forEach(el=>{
      if(el.dataset.model===name) el.classList.add('highlighted');
      else el.classList.add('dimmed');
    });
    document.querySelectorAll('tr[data-model]').forEach(el=>{
      if(el.dataset.model===name) el.classList.add('highlighted');
      else el.classList.add('dimmed');
    });
  }
  function unhighlightModel(){
    document.querySelectorAll('.donut-segment').forEach(el=>{el.classList.remove('highlighted','dimmed');});
    document.querySelectorAll('.trend-line').forEach(el=>{el.classList.remove('highlighted','dimmed');});
    document.querySelectorAll('.legend-item').forEach(el=>{el.classList.remove('highlighted','dimmed');});
    document.querySelectorAll('tr[data-model]').forEach(el=>{el.classList.remove('highlighted','dimmed');});
  }

  function highlightTool(code){
    document.querySelectorAll('.bar-fill[data-tool-bar]').forEach(el=>{
      if(el.dataset.toolBar===code) el.classList.add('highlighted');
      else el.classList.add('dimmed');
    });
  }
  function unhighlightTool(){
    document.querySelectorAll('.bar-fill').forEach(el=>{el.classList.remove('highlighted','dimmed');});
  }
</script>
</body>
</html>`;
  }

  // ── 加载态 ──

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<style>
  body{margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  .skeleton{height:76px;border-radius:12px;margin-bottom:10px;background:var(--vscode-textBlockQuote-background);animation:pulse 1.4s ease-in-out infinite}
  .skeleton.small{height:42px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .loading-text{margin-top:16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
  <div class="skeleton small"></div>
  <div class="skeleton"></div>
  <div class="grid"><div class="skeleton"></div><div class="skeleton"></div></div>
  <div class="loading-text">正在加载 ZAI 使用量数据...</div>
</body>
</html>`;
  }

  // ── 折线图 ──

  private generateLineChartSection(
    summary: QuotaSummary,
    modelColorMap: Map<string, string>,
  ): string {
    const ts = summary.modelTimeSeries;
    if (!ts || ts.xTime.length === 0) return "";

    const { xTime, totalTokensUsage, models, granularity } = ts;
    const W = 600, padL = 52, padR = 16, padT = 12;
    const dense = xTime.length > 30;
    const padB = dense ? 56 : 36;
    const H = 200 + (dense ? 20 : 0);
    const cw = W - padL - padR;
    const ch = H - padT - padB;

    const maxVal = Math.max(...totalTokensUsage, ...models.flatMap((m) => m.tokensUsage), 1);
    const niceMax = this.niceNum(maxVal);

    const yScale = (v: number) => padT + ch - (v / niceMax) * ch;
    const xStep = xTime.length > 1 ? cw / (xTime.length - 1) : cw;

    const maxLabels = 8;
    const labelStep = Math.max(1, Math.ceil(xTime.length / maxLabels));

    const yTicks = 4;
    let yAxisSvg = "";
    for (let i = 0; i <= yTicks; i++) {
      const v = (niceMax / yTicks) * i;
      const y = yScale(v);
      yAxisSvg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
      yAxisSvg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" fill="var(--muted)" font-size="9">${this.formatTokenCount(v)}</text>`;
    }

    const tickExtra = dense ? 20 : 16;
    let xAxisSvg = "";
    for (let i = 0; i < xTime.length; i += labelStep) {
      const x = padL + i * xStep;
      const raw = granularity === "hourly"
        ? xTime[i].replace(/^.*(\d{2})-(\d{2}) (\d{2}:\d{2})$/, "$2/$3").replace(/^.*(\d{2}:\d{2})$/, "$1")
        : xTime[i].replace(/^\d{4}-/, "");
      if (dense) {
        xAxisSvg += `<text x="0" y="0" text-anchor="end" fill="var(--muted)" font-size="9" transform="translate(${x},${H - padB + 10}) rotate(-40)">${raw}</text>`;
      } else {
        xAxisSvg += `<text x="${x}" y="${H - padB + tickExtra}" text-anchor="middle" fill="var(--muted)" font-size="9">${raw}</text>`;
      }
    }

    const lines = models
      .filter((m) => m.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((m) => {
        const color = modelColorMap.get(m.modelName) ?? CHART_COLORS[0];
        const points = m.tokensUsage.map((v, i) => `${padL + i * xStep},${yScale(v)}`).join(" ");
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" class="trend-line" data-model="${this.escapeHtml(m.modelName)}"
          onmouseenter="highlightModel('${this.escapeHtml(m.modelName)}')" onmouseleave="unhighlightModel()"/>`;
      })
      .join("\n");

    const totalArea = totalTokensUsage.map((v, i) => `${padL + i * xStep},${yScale(v)}`).join(" ");
    const areaPath = `<polygon points="${padL},${yScale(0)} ${totalArea} ${padL + (xTime.length - 1) * xStep},${yScale(0)}" fill="var(--apple-blue)" opacity="0.04"/>`;

    const legendItems = models
      .filter((m) => m.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((m) => {
        const color = modelColorMap.get(m.modelName) ?? CHART_COLORS[0];
        return `<span class="trend-legend-item clickable" data-model="${this.escapeHtml(m.modelName)}"
          onmouseenter="highlightModel('${this.escapeHtml(m.modelName)}')" onmouseleave="unhighlightModel()">
          <span class="trend-legend-dot" style="background:${color}"></span>${this.escapeHtml(m.modelName)}</span>`;
      })
      .join("");

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
      ${areaPath}${yAxisSvg}${xAxisSvg}${lines}
    </svg>`;

    return `<div class="trend-card">
      <div class="trend-header">
        <div class="trend-title">Token 用量趋势</div>
        <div class="trend-legend">${legendItems}</div>
      </div>
      ${svg}
    </div>`;
  }

  private niceNum(val: number): number {
    if (val <= 0) return 1;
    const exp = Math.floor(Math.log10(val));
    const frac = val / Math.pow(10, exp);
    let nice: number;
    if (frac <= 1.5) nice = 1.5;
    else if (frac <= 2) nice = 2;
    else if (frac <= 3) nice = 3;
    else if (frac <= 5) nice = 5;
    else if (frac <= 7) nice = 7;
    else nice = 10;
    return nice * Math.pow(10, exp);
  }

  private getRefreshInfoHtml(summary: QuotaSummary): string {
    const parts: string[] = [];
    if (this.isOffline) parts.push("⚡ 离线模式");
    if (summary.lastRefreshTime) {
      const ago = Math.floor((Date.now() - new Date(summary.lastRefreshTime).getTime()) / 60000);
      parts.push(ago < 1 ? "刚刚更新" : ago < 60 ? `${ago} 分钟前更新` : `更新于 ${new Date(summary.lastRefreshTime).toLocaleString("zh-CN", { hour12: false })}`);
    }
    if (summary.nextRefreshTime) {
      const until = Math.floor((new Date(summary.nextRefreshTime).getTime() - Date.now()) / 60000);
      if (until > 0) parts.push(`${until} 分钟后刷新`);
    }
    return parts.length > 0 ? parts.join(" · ") : `更新于 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
  }

  private getProgressColor(pct: number): string {
    if (pct >= 95) return "var(--apple-red)";
    if (pct >= 80) return "var(--apple-orange)";
    return "var(--apple-green)";
  }

  private formatTokenCount(v: number): string {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toString();
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
