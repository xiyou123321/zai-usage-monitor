# 设计：状态栏新增"每周 Token 用量"

- 日期：2026-07-07
- 范围：VS Code 扩展 `glm-usage-monitor` 的状态栏（`StatusBarManager`）
- 目标：左下角状态栏在现有「5 小时 Token (T%)」和「每月 MCP (M%)」之外，再显示「每周 Token (W%)」

## 背景与现状

状态栏目前按 `statusBarMode`（minimal / compact / detailed）显示：

- `detailed`：`$(icon) T{tp}% · M{mp}%`
- `compact`：`$(icon) T{tp}% M{mp}%`
- `minimal`：`$(icon) {max(tp,mp)}%`

其中：

- `T%` = `summary.tokenUsage.percentage`，即配额接口返回的第 1 个 `TOKENS_LIMIT`（5 小时滚动窗口）
- `M%` = `summary.mcpUsage.percentage`，即 `TIME_LIMIT`（每月）

**每周数据已经存在**：`GLMUsageService.parseQuotaSummary` 把第 2 个 `TOKENS_LIMIT` 标为 `label === "每周"`，存入 `summary.quotaItems`，面板 `UsagePanel.renderQuotaSection` 已在渲染它。因此本变更**不需要任何后端 / 取数 / 类型改动**，只让状态栏多读一项。

关键约束：**每周项不一定存在**——取决于账户 / 套餐是否返回第 2 个 `TOKENS_LIMIT`。必须优雅降级，缺失时退回当前 `T% · M%` 行为。

## 设计

### 1. 新增纯函数（可测试，不依赖 vscode）

新建 `src/util/quota.ts`，导出两个纯函数：

- `getWeeklyTokenItem(summary: QuotaSummary): QuotaItem | undefined`
  - 在 `summary.quotaItems` 中按 `type === "TOKENS_LIMIT" && label === "每周"` 查找（**按 label 而非下标**，避免 API 顺序变化导致取错）。
  - `quotaItems` 为空 / 缺失时返回 `undefined`。
- `getDominantPercentage(summary: QuotaSummary): number`
  - 现有逻辑（`StatusBarManager.getDominantPercentage`）：`tp >= 50 ? tp : Math.max(tp, mp)`。
  - 新逻辑纳入 weekly：`tp >= 50 ? tp : Math.max(tp, mp, wp ?? 0)`，其中 `wp = getWeeklyTokenItem(summary)?.percentage ?? 0`。
  - 保留 5h token 的优先权（`tp >= 50` 时由 tp 主导，因其重置最快、最紧迫）；否则取三者最大，使 weekly 见底时也能驱动预警。

把 `StatusBarManager` 内联的 `getDominantPercentage` 改为调用该纯函数，消除重复并使其可单测。

### 2. 状态栏文本 `getText()`（用户选定标签 `W`）

在 T 与 M 之间插入 `W{wp}%`：

- `detailed`：`$(icon) T{tp}% · W{wp}% · M{mp}%`（weekly 存在）
- `compact`：`$(icon) T{tp}% W{wp}% M{mp}%`（weekly 存在）
- `minimal`：`$(icon) {Math.max(tp, wp, mp)}%`（wp 纳入最大值，wp 缺失按 0）
- 离线缓存分支（`isOffline && currentSummary`）补上 `W{wp}%`

**降级规则**：`wp` 为 `undefined` 时整段省略 `W{wp}%`（含分隔符），退回现有 `T% · M%` / `T% M%`。

### 3. 颜色 `getColor()`

依赖 `getDominantPercentage()`，无需额外改动。weekly 达 80% / 95% 时状态栏自动变橙 / 红。

### 4. 悬停提示 `getTooltip()`

在 Token 行与 MCP 行之间新增一行（weekly 存在时）：

```
Token **{tp}%** · 重置 {时:分}        ← 5 小时（不变）
每周 **{wp}%** · 重置 {月/日 时:分}   ← 新增
MCP **{mp}%** · 重置 {月/日 时:分}    ← 每月（不变）
```

- weekly 重置时间用「月/日 时:分」格式（与 MCP 同款，因 weekly 跨天），从 `weeklyItem.resetAt` 读取，缺失显示 `--`。
- **在线分支与离线缓存分支都加**该行。
- weekly 缺失时不显示该行，退回现状。

### 5. 配置描述微调

`package.json` 中 `glmUsage.statusBarMode` 的 `description`：`"状态栏显示模式: minimal(仅百分比), compact(Token百分比), detailed(Token和MCP)"` → 把 `detailed(Token和MCP)` 改为 `detailed(Token、每周和MCP)`。仅文案，无逻辑变更。enum 值与 default 不变。

### 6. 测试

新建 `src/test/suite/quota.test.ts`，覆盖纯函数（测试在纯 Node + Mocha 下编译运行，`vscode` 仅作类型被擦除，故只测纯函数）：

- `getWeeklyTokenItem`：
  - weekly 存在（quotaItems 含两个 TOKENS_LIMIT）→ 返回 label="每周" 项
  - weekly 缺失（仅一个 TOKENS_LIMIT）→ `undefined`
  - `quotaItems` 为 `undefined` → `undefined`
- `getDominantPercentage`：
  - weekly 主导（wp 高、tp<50）→ 返回 wp
  - 5h 主导（tp≥50）→ 返回 tp（不受 wp 影响）
  - weekly 缺失 → 与旧逻辑 `Math.max(tp, mp)` 一致

解析层（`services.test.ts`）已有测试，不动。

## 涉及文件

- 新增：`src/util/quota.ts`、`src/test/suite/quota.test.ts`
- 修改：`src/services/StatusBarManager.ts`、`package.json`（仅文案）

## 非目标（YAGNI）

- 不改 `QuotaSummary` 类型、不新增字段（weekly 仍从 `quotaItems` 取）
- 不改 parser / API 请求 / 缓存
- 不改 `statusBarMode` 的 enum 与默认值
- 不改面板（`UsagePanel` 已支持渲染 weekly）
- 不改通知阈值逻辑（`ThresholdNotifier` 按 `tokenUsage.percentage` 即 5h 判断，保持现状）
