# 状态栏新增"每周 Token 用量" 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在左下角状态栏现有「5 小时 Token (T%)」「每月 MCP (M%)」之外，新增「每周 Token (W%)」，weekly 数据缺失时优雅降级。

**Architecture:** 每周用量已存在于 `summary.quotaItems`（第 2 个 `TOKENS_LIMIT`，`label==="每周"`）。新增两个不依赖 vscode 的纯函数（`src/util/quota.ts`）负责提取 weekly 与计算主导百分比，并以 TDD 覆盖；`StatusBarManager` 改为调用纯函数并在文本/提示/颜色中体现 weekly。无后端、无类型、无配置逻辑变更。

**Tech Stack:** TypeScript、VS Code Extension API、Mocha (tdd ui) + assert。

**Verification strategy（重要）：** 本仓库测试在纯 Node 下 `npm run compile && npm test` 运行，`vscode` 仅作类型被擦除，`StatusBarManager` 构造期调用 `vscode.window.createStatusBarItem` 无法在测试环境实例化（且当前无其单测）。因此：
- 纯函数 `quota.ts` → TDD 单测。
- `StatusBarManager` 文本/提示改动 → 以 `npm run compile`（tsc 类型检查）为自动门禁，并在最后一步按 F5 启动 Extension Development Host 做人工目视确认。
- `package.json` → 仅文案。

**前置基线：** 开始前确认 `npm run compile && npm test` 在干净 main 上通过（解析层已有测试）。

---

### Task 1: 纯函数 `src/util/quota.ts`（TDD）

**Files:**
- Create: `src/util/quota.ts`
- Create (test): `src/test/suite/quota.test.ts`

- [ ] **Step 1: 写失败测试 `src/test/suite/quota.test.ts`**

```typescript
import assert from "assert";
import { getDominantPercentage, getWeeklyTokenItem } from "../../util/quota";
import { QuotaItem, QuotaSummary } from "../../types/api";

function makeSummary(quotaItems?: QuotaItem[]): QuotaSummary {
  return {
    tokenUsage: { percentage: 0, used: 0, total: 0 },
    mcpUsage: { percentage: 0, used: 0, total: 0 },
    monthlyResetAt: "",
    quotaItems,
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
    const s = makeSummary([fiveHour, weekly, monthly]);
    assert.strictEqual(getWeeklyTokenItem(s), weekly);
  });

  test("returns undefined when only the 5h token limit exists", () => {
    const s = makeSummary([fiveHour, monthly]);
    assert.strictEqual(getWeeklyTokenItem(s), undefined);
  });

  test("returns undefined when quotaItems is undefined", () => {
    assert.strictEqual(getWeeklyTokenItem(makeSummary(undefined)), undefined);
  });

  test("returns undefined for null summary", () => {
    assert.strictEqual(getWeeklyTokenItem(null), undefined);
  });
});

suite("getDominantPercentage", () => {
  test("weekly dominates when tp < 50 and weekly is highest", () => {
    const s = makeSummary([
      { ...fiveHour, percentage: 20 },
      { ...weekly, percentage: 70 },
      { ...monthly, percentage: 10 },
    ]);
    assert.strictEqual(getDominantPercentage(s), 70);
  });

  test("5h token dominates when tp >= 50 (ignores weekly)", () => {
    const s = makeSummary([
      { ...fiveHour, percentage: 55 },
      { ...weekly, percentage: 90 },
      { ...monthly, percentage: 10 },
    ]);
    assert.strictEqual(getDominantPercentage(s), 55);
  });

  test("falls back to max(tp, mp) when weekly absent (legacy parity)", () => {
    const s = makeSummary([
      { ...fiveHour, percentage: 30 },
      { ...monthly, percentage: 40 },
    ]);
    assert.strictEqual(getDominantPercentage(s), 40);
  });

  test("returns 0 for null summary", () => {
    assert.strictEqual(getDominantPercentage(null), 0);
  });
});
```

- [ ] **Step 2: 创建存根实现 `src/util/quota.ts`（让项目能编译，但断言失败 = 红）**

```typescript
import { QuotaItem, QuotaSummary } from "../types/api";

export function getWeeklyTokenItem(
  summary: QuotaSummary | null | undefined,
): QuotaItem | undefined {
  return undefined;
}

export function getDominantPercentage(
  summary: QuotaSummary | null | undefined,
): number {
  return 0;
}
```

- [ ] **Step 3: 运行测试，确认红**

Run: `npm run compile && npm test`
Expected: 编译通过；4 条 `getWeeklyTokenItem` / `getDominantPercentage` 断言失败（得到 `undefined` / `0`）。

- [ ] **Step 4: 替换为真实实现 `src/util/quota.ts`**

```typescript
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
```

- [ ] **Step 5: 运行测试，确认绿**

Run: `npm run compile && npm test`
Expected: 全部通过（含原有解析层测试）。

- [ ] **Step 6: 提交**

```bash
git add src/util/quota.ts src/test/suite/quota.test.ts
git commit -m "$(cat <<'EOF'
Add pure quota helpers for weekly token usage

getWeeklyTokenItem locates the "每周" TOKENS_LIMIT in quotaItems;
getDominantPercentage folds it into the dominant percentage used for
status bar coloring. Backed by unit tests.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `StatusBarManager` 主导百分比改为调用纯函数

**Files:**
- Modify: `src/services/StatusBarManager.ts`

- [ ] **Step 1: 增加导入（紧跟现有 `../util/timeWindow` 导入之后）**

把文件顶部导入区：

```typescript
import { QuotaSummary, UsageRange } from "../types/api";
import { getUsageRangeLabel } from "../util/timeWindow";
```

改为：

```typescript
import { QuotaSummary, UsageRange } from "../types/api";
import { getDominantPercentage, getWeeklyTokenItem } from "../util/quota";
import { getUsageRangeLabel } from "../util/timeWindow";
```

- [ ] **Step 2: 删除私有方法 `getDominantPercentage`（约 143-151 行）**

删除整个方法：

```typescript
  /**
   * Get the dominant usage percentage for color calculation
   */
  private getDominantPercentage(): number {
    if (!this.currentSummary) return 0;
    const tp = this.currentSummary.tokenUsage.percentage;
    const mp = this.currentSummary.mcpUsage.percentage;
    // Token 优先：Token >= 50% 时用 Token，否则取 max
    return tp >= 50 ? tp : Math.max(tp, mp);
  }
```

- [ ] **Step 3: 替换 3 处调用点为纯函数调用**

`getColor()` 内（约第 160 行）：

```typescript
    const percentage = this.getDominantPercentage();
```

改为：

```typescript
    const percentage = getDominantPercentage(this.currentSummary);
```

`getTooltip()` 在线分支（约第 304 行 与 第 317 行）：

```typescript
      this.getHealthLabel(this.getDominantPercentage()),
```

改为：

```typescript
      this.getHealthLabel(getDominantPercentage(this.currentSummary)),
```

```typescript
      this.getDominantPercentage() >= 80 ? "warning" : "info",
```

改为：

```typescript
      getDominantPercentage(this.currentSummary) >= 80 ? "warning" : "info",
```

- [ ] **Step 4: 编译确认无类型错误**

Run: `npm run compile`
Expected: 编译通过，无错误（行为等价重构：weekly 已通过纯函数纳入）。

- [ ] **Step 5: 提交**

```bash
git add src/services/StatusBarManager.ts
git commit -m "$(cat <<'EOF'
Route status bar dominant percentage through pure helper

StatusBarManager now calls getDominantPercentage(currentSummary) from
util/quota, which also factors in the weekly token limit.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 状态栏文本 `getText()` 新增 `W%`

**Files:**
- Modify: `src/services/StatusBarManager.ts`（`getText()` 方法，约 186-222 行）

- [ ] **Step 1: 用以下完整方法替换现有 `getText()`**

```typescript
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
```

- [ ] **Step 2: 编译确认**

Run: `npm run compile`
Expected: 编译通过，无错误。

- [ ] **Step 3: 提交**

```bash
git add src/services/StatusBarManager.ts
git commit -m "$(cat <<'EOF'
Show weekly token usage (W%) in status bar text

Adds a W{wp}% segment between Token (5h) and MCP in detailed/compact/
minimal/offline modes. Omitted entirely when the weekly limit is absent.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 悬停提示 `getTooltip()` 新增"每周"行

**Files:**
- Modify: `src/services/StatusBarManager.ts`（`getTooltip()` 在线与离线两个分支，并新增私有辅助方法）

- [ ] **Step 1: 在 `formatTooltipTokens` 方法之前新增私有辅助方法 `formatWeeklyTooltipLine`**

```typescript
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
```

- [ ] **Step 2: 离线分支插入每周行（约 240-253 行）**

把离线分支的 `return this.createTooltipMarkdown(...)` 调用：

```typescript
        return this.createTooltipMarkdown(
          "ZAI Usage",
          "离线缓存",
          [
            `Token **${tokenUsage.percentage.toFixed(1)}%** · 重置 ${tokenResetTime}`,
            `MCP **${mcpUsage.percentage.toFixed(1)}%** · 重置 ${mcpResetTime}`,
            "",
            `范围：${getUsageRangeLabel(this.currentRange)}`,
            `消耗 ${totalTokens > 0 ? this.formatTooltipTokens(totalTokens) : "--"} · 调用 ${totalModelCalls.toLocaleString("zh-CN")}`,
            "",
            "点击打开面板",
          ],
          "warning",
        );
```

改为（先构造数组、按需插入每周行）：

```typescript
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
```

- [ ] **Step 3: 在线分支插入每周行（约 302-318 行）**

把在线分支的 `return this.createTooltipMarkdown(...)` 调用：

```typescript
    return this.createTooltipMarkdown(
      "ZAI Usage",
      this.getHealthLabel(getDominantPercentage(this.currentSummary)),
      [
        `Token **${tokenUsage.percentage.toFixed(1)}%** · 重置 ${tokenResetTime}`,
        `MCP **${mcpUsage.percentage.toFixed(1)}%** · 重置 ${mcpResetTime}`,
        "",
        `范围：${getUsageRangeLabel(this.currentRange)}`,
        `消耗 ${totalTokens > 0 ? this.formatTooltipTokens(totalTokens) : "--"} · 调用 ${totalModelCalls.toLocaleString("zh-CN")} · 平均 ${avgTokPerCall.toLocaleString("zh-CN")} tok/call`,
        `模型 ${modelCount} 个 · 工具 ${totalToolCalls.toLocaleString("zh-CN")}`,
        topModel ? `主力：${topModel.modelName} (${this.formatTooltipTokens(topModel.totalTokens)})` : "",
        topToolName ? `常用工具：${topToolName}` : "",
        "",
        "点击打开面板",
      ],
      getDominantPercentage(this.currentSummary) >= 80 ? "warning" : "info",
    );
```

改为：

```typescript
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
```

- [ ] **Step 4: 编译确认**

Run: `npm run compile`
Expected: 编译通过，无错误。

- [ ] **Step 5: 提交**

```bash
git add src/services/StatusBarManager.ts
git commit -m "$(cat <<'EOF'
Add weekly token line to status bar tooltip

Inserts a "每周 X% · 重置 ..." line between the 5h Token and MCP lines
in both online and offline tooltip branches. Omitted when weekly absent.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 更新 `statusBarMode` 配置文案

**Files:**
- Modify: `package.json`（约第 117 行 `description`）

- [ ] **Step 1: 修改 description**

把：

```json
          "description": "状态栏显示模式: minimal(仅百分比), compact(Token百分比), detailed(Token和MCP)"
```

改为：

```json
          "description": "状态栏显示模式: minimal(仅百分比), compact(Token百分比), detailed(Token、每周和MCP)"
```

- [ ] **Step 2: 提交**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
Update statusBarMode description to mention weekly metric

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 全量验证

**Files:** 无（仅运行与人工确认）

- [ ] **Step 1: 全量编译 + 单测**

Run: `npm run compile && npm test`
Expected: 编译通过；全部测试通过（含新增 `quota.test.ts` 与原有解析层测试）。

- [ ] **Step 2: 人工目视确认（启动扩展宿主）**

在 VS Code 中按 `F5` 启动 Extension Development Host（使用 `.vscode/launch.json`）：
- 状态栏显示形如 `$(pulse) T18% · W42% · M7%`（detailed）。
- 鼠标悬停，提示在 Token 行与 MCP 行之间出现 `每周 **42.x%** · 重置 MM/DD HH:MM`。
- 若该账户无 weekly 配额，则退回 `T% · M%`、提示无每周行（确认降级生效）。
- 在 `minimal` / `compact` 模式（命令面板搜配置或改 `glmUsage.statusBarMode`）下确认 weekly 被纳入最大值 / 以 `W%` 显示。

- [ ] **Step 3（可选）: 人工确认后，无需额外提交（本任务无代码变更）**

---

## Self-Review 结论

- **Spec 覆盖**：spec 第 1 节（纯函数）→ Task 1；第 2 节（文本）→ Task 3；第 3 节（颜色）→ Task 2（通过纯函数）；第 4 节（提示）→ Task 4；第 5 节（配置文案）→ Task 5；降级规则在各任务的 `wp === undefined` 分支覆盖；Task 6 覆盖验证。无遗漏。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致性**：`getWeeklyTokenItem`、`getDominantPercentage`、`formatWeeklyTooltipLine` 名称与签名在所有任务中一致；`QuotaItem.label`/`.percentage`/`.resetAt` 与 `src/types/api.ts` 定义一致。
