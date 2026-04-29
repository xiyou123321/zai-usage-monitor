# 发布说明

## 当前流程

### 本地发布

1. 更新版本号与文档
2. 运行 `npm run compile`
3. 运行 `npx @vscode/vsce package --no-dependencies`
4. 提交代码并创建版本 tag，例如 `v0.0.4`
5. 推送分支与 tag

### GitHub Actions

- `CI`
  - 在 `master` push 和 PR 时执行
  - 使用 `npm ci` 安装依赖
  - 执行 `npm run compile`

- `Release`
  - 在推送 `v*` tag 时执行
  - 自动编译并生成 `.vsix`
  - 自动创建 GitHub Release
  - 自动上传 `.vsix` 产物

## 常用命令

```bash
npm run compile
npx @vscode/vsce package --no-dependencies
git tag v0.0.4
git push origin master
git push origin v0.0.4
```

## 产物命名

VSIX 文件默认命名格式：

```text
zai-usage-monitor-<version>.vsix
```
