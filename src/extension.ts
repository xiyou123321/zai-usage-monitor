import * as vscode from "vscode";
import { CacheService } from "./core/CacheService";
import { AuthService } from "./services/AuthService";
import { GLMUsageService } from "./services/GLMUsageService";
import { StatusBarManager } from "./services/StatusBarManager";
import { UsagePanel } from "./views/UsagePanel";
import { ThresholdNotifier } from "./notifications/ThresholdNotifier";
import { QuotaSummary, UsageRange } from "./types/api";

let refreshTimer: NodeJS.Timeout | undefined;
let authService: AuthService;
let glmUsageService: GLMUsageService | undefined;
let statusBarManager: StatusBarManager;
let usagePanel: UsagePanel;
let thresholdNotifier: ThresholdNotifier;
let cacheService: CacheService;
let currentRange: UsageRange = "today";
let summaryCache: Map<UsageRange, QuotaSummary> = new Map();
let lastRefreshTime: Date | null = null;
let nextRefreshTime: Date | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("glmUsage");
  authService = new AuthService(context.secrets, config);

  // Initialize new services
  cacheService = new CacheService();
  const statusBarMode = config.get<"minimal" | "compact" | "detailed">(
    "statusBarMode",
    "detailed",
  );
  statusBarManager = new StatusBarManager(statusBarMode);
  usagePanel = new UsagePanel(context);

  // Initialize threshold notifier with config values and context for persistence
  const thresholds = config.get<number[]>(
    "notificationThresholds",
    [50, 80, 95],
  );
  const notificationEnabled = config.get<boolean>("notificationEnabled", true);
  thresholdNotifier = new ThresholdNotifier(thresholds, notificationEnabled, context);

  // Check if credentials exist - use passive notification instead of modal
  const credentials = await authService.getCredentials();
  if (!credentials) {
    statusBarManager.showNoCredentials();
  } else {
    scheduleRefresh(config);
  }

  // Show usage command
  const showUsageCommand = vscode.commands.registerCommand(
    "glmUsage.showUsage",
    async () => {
      await showUsagePanel();
    },
  );

  // Refresh command
  const refreshCommand = vscode.commands.registerCommand(
    "glmUsage.refresh",
    async () => {
      await refreshUsage(true);
    },
  );

  // Change range command
  const changeRangeCommand = vscode.commands.registerCommand(
    "glmUsage.changeRange",
    async (range: UsageRange) => {
      currentRange = range;
      cacheService.clear();
      // Show loading state immediately for better UX
      usagePanel.showLoading();
      statusBarManager.showLoading();
      await refreshUsage(false);
    },
  );

  // Configure command
  const configureCommand = vscode.commands.registerCommand(
    "glmUsage.configure",
    async () => {
      await showConfigurationDialog();
    },
  );

  // Clear credentials command
  const clearCredentialsCommand = vscode.commands.registerCommand(
    "glmUsage.clearCredentials",
    async () => {
      await authService.clearCredentials();
      cacheService.clear();
      vscode.window.showInformationMessage(
        "已清除存储的凭证，下次使用时将使用环境变量或重新配置。",
      );
      statusBarManager.clear();
    },
  );

  // Diagnose credentials command
  const diagnoseCommand = vscode.commands.registerCommand(
    "glmUsage.diagnose",
    async () => {
      const outputChannel = vscode.window.createOutputChannel(
        "ZAI Usage Diagnostics",
      );

      outputChannel.appendLine("=== ZAI Usage 凭证诊断 ===\n");

      const { debug } = await authService.getCredentialsWithDebug();
      debug.forEach((line) => outputChannel.appendLine(`• ${line}`));

      outputChannel.appendLine("\n=== 缓存状态 ===");
      const stats = cacheService.getStats();
      outputChannel.appendLine(
        `  命中率: ${stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0}%`,
      );
      outputChannel.appendLine(`  缓存条目: ${stats.size}`);

      outputChannel.appendLine("\n=== 当前环境信息 ===");
      outputChannel.appendLine(`Home: ${process.env.HOME || "未设置"}`);
      outputChannel.appendLine(`Platform: ${process.platform}`);
      outputChannel.appendLine(`VSCode Version: ${vscode.version}`);

      outputChannel.appendLine("\n=== Claude Code 配置文件状态 ===");
      const fs = require("fs");
      const path = require("path");
      const settingsPath = path.join(
        process.env.HOME || "",
        ".claude",
        "settings.json",
      );
      if (fs.existsSync(settingsPath)) {
        outputChannel.appendLine(`✓ 配置文件存在: ${settingsPath}`);
        try {
          const content = fs.readFileSync(settingsPath, "utf-8");
          const settings = JSON.parse(content);
          if (
            settings.env?.ANTHROPIC_AUTH_TOKEN &&
            settings.env?.ANTHROPIC_BASE_URL
          ) {
            outputChannel.appendLine("✓ 包含所需的凭证信息");
          } else {
            outputChannel.appendLine(
              "✗ 配置文件中缺少 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_BASE_URL",
            );
          }
        } catch (e) {
          outputChannel.appendLine(
            `✗ 无法读取配置文件: ${e instanceof Error ? e.message : "Unknown error"}`,
          );
        }
      } else {
        outputChannel.appendLine(`✗ 配置文件不存在: ${settingsPath}`);
      }

      outputChannel.appendLine("\n=== 凭证获取优先级 ===");
      outputChannel.appendLine(
        "1. Claude Code 配置文件 (~/.claude/settings.json)",
      );
      outputChannel.appendLine("2. VSCode 进程环境变量");
      outputChannel.appendLine("3. 手动配置的凭证");

      outputChannel.show();
    },
  );

  // Register all disposables
  context.subscriptions.push(
    showUsageCommand,
    refreshCommand,
    changeRangeCommand,
    configureCommand,
    clearCredentialsCommand,
    diagnoseCommand,
    statusBarManager,
  );

  // Configuration change listener
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(
    async (e) => {
      if (e.affectsConfiguration("glmUsage")) {
        const newConfig = vscode.workspace.getConfiguration("glmUsage");
        const hasCredentials = await authService.hasCredentials();
        if (hasCredentials) {
          // Update threshold notifier config
          const newThresholds = newConfig.get<number[]>(
            "notificationThresholds",
            [50, 80, 95],
          );
          const newEnabled = newConfig.get<boolean>(
            "notificationEnabled",
            true,
          );
          thresholdNotifier.setThresholds(newThresholds);
          thresholdNotifier.setEnabled(newEnabled);

          // Update status bar mode
          const newMode = newConfig.get<"minimal" | "compact" | "detailed">(
            "statusBarMode",
            "detailed",
          );
          statusBarManager.setMode(newMode);

          scheduleRefresh(newConfig);
        } else {
          statusBarManager.clear();
        }
      }
    },
  );
  context.subscriptions.push(configChangeListener);
}

async function fetchAndParseUsage(range: UsageRange): Promise<QuotaSummary | null> {
  const credsWithSource = await authService.getCredentialsWithSource();
  if (!credsWithSource) {
    throw new Error("未配置凭证");
  }

  const cacheEnabled = vscode.workspace
    .getConfiguration("glmUsage")
    .get<boolean>("cacheEnabled", true);

  if (!glmUsageService) {
    glmUsageService = new GLMUsageService(credsWithSource.creds, cacheService, cacheEnabled);
  }

  // 首先检查是否有缓存的摘要数据
  const cachedSummary = summaryCache.get(range);

  // 网络请求
  const forceRefresh = !cacheEnabled;
  const data = await Promise.all([
    glmUsageService.fetchQuotaLimits(forceRefresh),
    glmUsageService.fetchModelUsage(range, forceRefresh),
    glmUsageService.fetchToolUsage(range, forceRefresh),
  ]);

  // 检查网络状态
  const networkStatus = glmUsageService.getNetworkStatus();
  const hasAnyData = data.some(d => d !== null);

  // 如果网络请求全部失败，使用缓存数据
  if (!hasAnyData) {
    if (cachedSummary) {
      // 有缓存数据，返回缓存并标记为离线
      cachedSummary.isOffline = true;
      return cachedSummary;
    }
    // 没有缓存数据，返回 null
    return null;
  }

  // 至少部分数据成功，组合数据（缓存和在线数据混合）
  const quotaLimits = data[0] ?? (cachedSummary ? { limits: [] } : null);
  const modelUsage = data[1] ?? null;
  const toolUsage = data[2] ?? null;

  const summary = glmUsageService.parseCompleteUsageData(
    quotaLimits,
    modelUsage,
    toolUsage,
  );

  summary.credentialSource = credsWithSource.source ?? undefined;
  summary.lastRefreshTime = lastRefreshTime?.toISOString();
  summary.nextRefreshTime = nextRefreshTime?.toISOString();

  // 标记离线状态
  if (!networkStatus.isOnline) {
    summary.isOffline = true;
  }

  summaryCache.set(range, summary);
  return summary;
}

async function showUsagePanel(): Promise<void> {
  const summary = summaryCache.get(currentRange);
  if (!summary) {
    statusBarManager.showLoading();
    try {
      const newSummary = await fetchAndParseUsage(currentRange);

      // 如果返回 null 表示完全没有数据
      if (!newSummary) {
        statusBarManager.showError("无法获取数据，请检查网络连接");
        vscode.window.showErrorMessage("获取数据失败: 无法连接到服务器，且无可用缓存");
        return;
      }

      // 检查是否离线
      if (newSummary.isOffline) {
        statusBarManager.showOffline();
      } else {
        statusBarManager.update(newSummary, currentRange);
      }

      // Don't show notifications when user explicitly opens the panel
      // Only show notifications for automatic refreshes or manual refresh command
      await usagePanel.show(newSummary, currentRange);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      statusBarManager.showError(message);
      vscode.window.showErrorMessage(`获取数据失败: ${message}`);
    }
    return;
  }

  await usagePanel.show(summary, currentRange);
}

async function refreshUsage(showNotification = false, skipNotification = false): Promise<void> {
  statusBarManager.showLoading();
  usagePanel.showLoading();

  try {
    const summary = await fetchAndParseUsage(currentRange);

    // 如果返回 null 表示完全没有数据（既没有网络也没有缓存）
    if (!summary) {
      statusBarManager.showError("无法获取数据，请检查网络连接");
      return;
    }

    // 检查是否离线
    const isOffline = (summary as any).isOffline === true;

    if (isOffline) {
      // 离线模式 - 显示缓存数据，不弹出通知
      statusBarManager.showOffline();
      usagePanel.showOffline();
    } else {
      // 在线模式 - 正常更新
      statusBarManager.update(summary, currentRange);
      usagePanel.hideOffline();

      // Only check threshold notifications if not skipping (e.g., on startup)
      if (!skipNotification) {
        thresholdNotifier.check(summary);
      }

      // Update refresh times
      lastRefreshTime = new Date();
      const refreshConfig = vscode.workspace.getConfiguration("glmUsage");
      const interval = refreshConfig.get<number>("refreshInterval", 600000);
      if (refreshConfig.get<boolean>("autoRefresh", true)) {
        nextRefreshTime = new Date(Date.now() + interval);
      }

      if (showNotification) {
        vscode.window.showInformationMessage(
          `ZAI Usage: Token ${Math.round(summary.tokenUsage.percentage)}% | MCP ${Math.round(summary.mcpUsage.percentage)}%`,
        );
      }
    }

    // Update panel if open
    await usagePanel.update(summary, currentRange);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    // 只有在用户主动刷新时才显示错误通知
    if (showNotification) {
      vscode.window.showErrorMessage(`ZAI 使用量获取失败: ${message}`);
    }
    statusBarManager.showError(message);
  }
}

function scheduleRefresh(config: vscode.WorkspaceConfiguration): void {
  const interval = config.get<number>("refreshInterval", 600000);
  const autoRefresh = config.get<boolean>("autoRefresh", true);

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  if (autoRefresh) {
    refreshTimer = setInterval(() => {
      refreshUsage(false, false);
    }, interval);
  }

  // Delay initial refresh to avoid startup noise and notifications
  // Skip threshold notifications on startup to avoid annoying users after reload
  setTimeout(() => {
    refreshUsage(false, true);
  }, 2000); // 2 second delay
}

export function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  usagePanel.dispose();
  statusBarManager.dispose();
}

async function showConfigurationDialog(): Promise<void> {
  const authToken = await vscode.window.showInputBox({
    prompt: "输入 ZAI API Auth Token",
    placeHolder: "sk-...",
    password: true,
    ignoreFocusOut: true,
  });

  if (!authToken) {
    return;
  }

  const baseUrl = await vscode.window.showInputBox({
    prompt: "输入 ZAI API Base URL",
    value: "https://api.z.ai/api/anthropic",
    ignoreFocusOut: true,
  });

  if (!baseUrl) {
    return;
  }

  // Validate credentials before saving
  const validationProgress = vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "正在验证凭证...",
      cancellable: false,
    },
    async () => {
      try {
        const testService = new GLMUsageService(
          { authToken, baseUrl },
          cacheService,
          false,
        );
        await testService.fetchQuotaLimits(true);
        return { success: true, error: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "验证失败",
        };
      }
    },
  );

  const validation = await validationProgress;

  if (!validation.success) {
    const action = await vscode.window.showErrorMessage(
      `凭证验证失败: ${validation.error}`,
      "重新配置",
      "仍要保存",
    );

    if (action === "重新配置") {
      await showConfigurationDialog();
      return;
    } else if (action !== "仍要保存") {
      return;
    }
  }

  await authService.storeCredentials(authToken, baseUrl);
  cacheService.clear();
  vscode.window.showInformationMessage(
    validation.success ? "凭证验证通过并保存成功。" : "凭证已保存（未验证）。",
  );

  const config = vscode.workspace.getConfiguration("glmUsage");
  scheduleRefresh(config);
}
