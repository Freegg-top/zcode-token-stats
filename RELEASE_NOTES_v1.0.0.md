# ZCode Token Stats v1.0.0

首个公开发布版本。

## 功能

- **统计胶囊**：输入框工具栏两个胶囊——活动（轮数/步数、模型用时、工具调用用时、TTFT、TPS）与用量（输入、缓存读取、缓存写入、输出、今日、项目、上下文）。
- **只读 SQLite 数据层**：直接读取本地 `db.sqlite`，不改 `zcode.cjs`，不生成完整 `app.asar` 备份。
- **自动适配安装**：按内容特征定位渲染 bundle，AST 定位插入点；结构不唯一时安全拒绝安装并恢复原包。
- **插件市场接入**：`/install-overlay`、`/uninstall-overlay` 命令与 SessionStart 漂移检查。
- **自动补丁**：胶囊未注入时，在你完全退出 ZCode 时自动完成安装、校验并重启；`-NoRelaunch` 可关闭自动重启。

## 发布资产

- `ZCode-Token-Stats-1.0.0-direct-win-x64.zip`
- `ZCode-Token-Stats-1.0.0-direct-win-x64.sha256.txt`
