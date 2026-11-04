---
description: 卸载 ZCode Token 统计胶囊并恢复原始文件
---

帮用户卸载 ZCode Token 统计胶囊。卸载会从 `app.asar` 主入口移除 loader 引用行、删除渲染层补丁，并清理 `%LOCALAPPDATA%\ZCodeTokenStats` 下的运行时目录；不触碰其他本地补丁和 ZCode 数据。必须完全退出 ZCode 后重新打开才生效。

按以下步骤执行：

1. 确认用户确实要卸载（此操作会移除统计胶囊显示）。
2. 运行卸载：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/update-overlay.ps1" -Uninstall
   ```

3. 按脚本输出分支处理：
   - **卸载成功**：提醒用户完全退出 ZCode（包括托盘）后重新打开，统计胶囊消失即为恢复成功。
   - **提示 ZCode 正在运行**：请用户手动完全退出 ZCode 后再运行一次第 2 步。
4. 如果脚本提示未检测到安装，告知本就未安装，无需操作。
5. 不要在用户未确认的情况下关闭或重启 ZCode。

**卸载顺序（关键）**：必须先运行本命令清除 app.asar 注入，**再**在插件 UI 里卸载插件。反过来做的后果：`/uninstall-overlay` 随插件一起消失，注入代码留在 asar 里指向一个已不存在的体系，之后只能重装插件才能清理。
