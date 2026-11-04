# Changelog

## 1.0.0

- 首个公开发布版本。
- 只读 SQLite 数据层：直接读取本地 `db.sqlite`，提供会话/项目/今日累计、TTFT 与上下文用量；不改 `zcode.cjs`，不生成完整 `app.asar` 备份。
- Electron 主进程 loader 向渲染层派发 `ztsSnapshot`，无 Python 常驻进程。
- 输入框统计胶囊：活动面板（轮数/步数、模型用时、工具调用用时、TTFT、TPS），用量面板（输入、缓存读取、缓存写入、输出、今日、项目、上下文）。
- 自动适配安装：按内容特征定位渲染 bundle，AST 定位插入点；结构不唯一时安全拒绝安装并恢复原包。
- 单入口发布布局：根目录仅保留 `安装.cmd`、`检查.cmd`、`卸载.cmd`、说明文档和 `_internal`。
- 插件市场接入：`/install-overlay`、`/uninstall-overlay` 命令与 SessionStart 漂移检查。
- SessionStart 自动补丁：胶囊未注入时，完全退出 Z-Code 后自动安装、校验并重启；arm 令牌防多会话重复安装，`-NoRelaunch` 可关闭自动重启。
- 路径全部自动定位（命令行参数 → `ZCODE_ASAR`/`ZCODE_HOME` → 默认安装位置），无硬编码本机路径。
