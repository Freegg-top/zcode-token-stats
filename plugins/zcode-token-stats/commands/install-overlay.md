---
description: 安装或更新 ZCode Token 统计胶囊（direct SQLite 架构）
---

帮用户安装或更新 ZCode Token 统计胶囊。该流程会修改 ZCode 的 `app.asar`（只追加一行 loader 引用），必须完全退出 ZCode 后重新打开才生效；不创建后台任务、常驻进程或登录启动项。

按以下步骤执行：

1. 先运行版本检查，把结果解读给用户：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/update-overlay.ps1" -Check
   ```

2. 如果已安装且已是最新版本：告知无需操作，结束。
3. 如果未安装或有更新，运行安装：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/update-overlay.ps1" -Install
   ```

4. 按脚本输出分支处理：
   - **安装成功**：提醒用户完全退出 ZCode（包括托盘）后重新打开；胶囊出现在输入框工具栏，展开面板在胶囊上方。
   - **提示 ZCode 正在运行**：询问用户是否现在退出 ZCode。用户同意并明确要求等待时，可改用 `-Install -WaitForExit`（ZCode 退出后自动安装一次，一次性进程，装完即退出）；否则请用户手动完全退出 ZCode 后再运行一次第 3 步。
   - **下载或校验失败**：展示脚本的错误输出，检查网络后最多重试一次，仍失败则建议用户从 https://github.com/Freegg-top/zcode-token-stats/releases 手动下载。
5. 不要在用户未确认的情况下关闭或重启 ZCode。
