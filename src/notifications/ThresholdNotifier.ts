import * as vscode from "vscode";
import { QuotaSummary } from "../types/api";

const STORAGE_KEY = "glmUsage.thresholdState";

/**
 * Manages threshold-based notifications for ZAI usage
 * Persists notification state across extension reloads and window sessions
 */
export class ThresholdNotifier {
  private thresholds: number[];
  private enabled: boolean;
  private notifiedThresholds: Set<number> = new Set();
  private lastResetDate: string | null = null;
  private snoozeUntil: number | null = null;
  private snoozeAllForToday: boolean = false;
  private lastSnoozeDate: string | null = null;
  private context: vscode.ExtensionContext;

  constructor(
    thresholds: number[] = [50, 80, 95],
    enabled: boolean = true,
    context?: vscode.ExtensionContext,
  ) {
    this.thresholds = thresholds.sort((a, b) => a - b);
    this.enabled = enabled;
    this.context = context as vscode.ExtensionContext;

    // Restore persisted state if context is available
    if (this.context) {
      this.restoreState();
    }
  }

  /**
   * Restore notification state from persistent storage
   */
  private restoreState(): void {
    try {
      const savedState = this.context.globalState.get<{
        notifiedThresholds: number[];
        lastResetDate: string | null;
        snoozeUntil: number | null;
        snoozeAllForToday: boolean;
        lastSnoozeDate: string | null;
      }>(STORAGE_KEY);

      if (savedState) {
        this.notifiedThresholds = new Set(savedState.notifiedThresholds || []);
        this.lastResetDate = savedState.lastResetDate || null;
        this.snoozeUntil = savedState.snoozeUntil || null;
        this.snoozeAllForToday = savedState.snoozeAllForToday || false;
        this.lastSnoozeDate = savedState.lastSnoozeDate || null;
      }
    } catch (error) {
      // If restoration fails, start with fresh state
      console.error("Failed to restore threshold state:", error);
    }
  }

  /**
   * Save current notification state to persistent storage
   */
  private saveState(): void {
    try {
      this.context.globalState.update(STORAGE_KEY, {
        notifiedThresholds: Array.from(this.notifiedThresholds),
        lastResetDate: this.lastResetDate,
        snoozeUntil: this.snoozeUntil,
        snoozeAllForToday: this.snoozeAllForToday,
        lastSnoozeDate: this.lastSnoozeDate,
      });
    } catch (error) {
      console.error("Failed to save threshold state:", error);
    }
  }

  /**
   * Check usage against thresholds and show notifications if needed
   * Returns true if a notification was shown
   */
  check(summary: QuotaSummary): boolean {
    if (!this.enabled) return false;

    const dominantPercentage = Math.max(
      summary.tokenUsage.percentage,
      summary.mcpUsage.percentage,
    );

    // Check if we need to reset notified thresholds (new month)
    // Use token reset time (hourly) for token-based notifications
    // Use mcp reset time (monthly) for mcp-based notifications
    const isTokenHigher =
      summary.tokenUsage.percentage >= summary.mcpUsage.percentage;
    const currentResetDate = isTokenHigher
      ? summary.tokenResetAt
        ? new Date(summary.tokenResetAt).toDateString()
        : new Date().toDateString()
      : summary.mcpResetAt
        ? new Date(summary.mcpResetAt).toDateString()
        : new Date().toDateString();

    if (currentResetDate !== this.lastResetDate) {
      this.notifiedThresholds.clear();
      this.lastResetDate = currentResetDate;
      this.snoozeAllForToday = false;
      this.lastSnoozeDate = null;
      this.saveState();
    }

    // Check if snooze period has expired
    if (this.snoozeUntil && Date.now() < this.snoozeUntil) {
      return false;
    }
    const hadSnooze = this.snoozeUntil !== null;
    this.snoozeUntil = null;
    if (hadSnooze) {
      this.saveState();
    }

    // Check if snoozed for today
    const today = new Date().toDateString();
    if (this.snoozeAllForToday && this.lastSnoozeDate === today) {
      return false;
    }
    if (this.lastSnoozeDate !== today) {
      this.snoozeAllForToday = false;
      this.saveState();
    }

    // Find the highest threshold that has been reached but not yet notified
    let triggeredThreshold: number | null = null;
    for (const threshold of this.thresholds) {
      if (
        dominantPercentage >= threshold &&
        !this.notifiedThresholds.has(threshold)
      ) {
        triggeredThreshold = threshold;
      }
    }

    if (triggeredThreshold !== null) {
      this.notifiedThresholds.add(triggeredThreshold);
      this.saveState();
      this.showNotification(triggeredThreshold, dominantPercentage, summary);
      return true;
    }

    return false;
  }

  /**
   * Show VS Code notification for threshold reached
   */
  private showNotification(
    threshold: number,
    actualPercentage: number,
    summary: QuotaSummary,
  ): void {
    const isTokenHigher =
      summary.tokenUsage.percentage >= summary.mcpUsage.percentage;
    const usageType = isTokenHigher ? "Token" : "MCP";

    let message: string;

    if (threshold >= 95) {
      message = `⚠️ ZAI ${usageType} 用量已达 ${Math.round(actualPercentage)}%，接近月度限制！`;
    } else if (threshold >= 80) {
      message = `🟡 ZAI ${usageType} 用量已达 ${Math.round(actualPercentage)}%，请注意控制使用`;
    } else {
      message = `📊 ZAI ${usageType} 用量已达 ${Math.round(actualPercentage)}%`;
    }

    vscode.window
      .showInformationMessage(message, "查看详情", "1小时后提醒", "今日不再提醒")
      .then((selection) => {
        if (selection === "查看详情") {
          vscode.commands.executeCommand("glmUsage.showUsage");
        } else if (selection === "1小时后提醒") {
          this.snooze(60 * 60 * 1000); // 1 hour
        } else if (selection === "今日不再提醒") {
          this.snoozeAllForToday = true;
          this.lastSnoozeDate = new Date().toDateString();
        }
      });
  }

  /**
   * Snooze notifications for a specified duration
   */
  private snooze(durationMs: number): void {
    this.snoozeUntil = Date.now() + durationMs;
    this.saveState();
  }

  /**
   * Reset all notified thresholds
   */
  reset(): void {
    this.notifiedThresholds.clear();
    this.lastResetDate = null;
    this.saveState();
  }

  /**
   * Update thresholds configuration
   */
  setThresholds(thresholds: number[]): void {
    this.thresholds = thresholds.sort((a, b) => a - b);
  }

  /**
   * Enable or disable notifications
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get currently notified thresholds
   */
  getNotifiedThresholds(): number[] {
    return Array.from(this.notifiedThresholds);
  }
}
