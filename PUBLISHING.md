# GitHub 公开发布清单

## 1. 先建立干净仓库

不要把当前补丁目录直接上传。当前目录包含约 300 MB 的 `app.asar` 备份、`zcode.cjs` 备份、日志和用户数据。

建议仓库只包含：

```text
src/                 patch.js、patch-lib.js、auto-patch.cjs、cli-patch.cjs、stats-core.js、renderer-component.txt
installer/           install.ps1、install.cmd、uninstall.cmd、check.cmd
tests/               统计单测、组件渲染测试、补丁可逆性测试、测试 fixture
docs/                安装、兼容性、数据边界、故障排查
README.md
LICENSE
SECURITY.md
.gitignore
.github/workflows/    Windows CI 与 Release 构建
```

`.gitignore` 至少排除：

```text
node_modules/
app.asar
app.asar.unpacked/
app.asar.before-*
zcode.cjs.before-*
*.asar
*.zip
*.log
*.env
.env*
*.png
zcode-cli-test.cjs
```

## 2. 许可证与声明

- 自己的补丁脚本使用 MIT；`LICENSE` 写明年份和版权人。
- 不要提交 ZCode 的 `app.asar`、`zcode.cjs` 原始文件、安装包或反编译源码。
- README 明确：非 ZCode / DeepSeek 官方项目，不提供任何担保，安装前会修改本地文件。
- 不要使用官方 Logo、品牌名做仓库头像或误导性命名；项目名建议 `zcode-token-stats`，并加非官方声明。

## 3. 测试与 CI

- CI 运行 `node --experimental-vm-modules test-dsh.cjs` 和 PowerShell 脚本语法检查。
- 当前整包测试依赖本机 `app.asar.backup-20261102-final`，公开仓库不能提交它。将涉及 ZCode bundle 的测试改为：
  - 自建最小 fixture，或
  - 无备份时自动跳过，只保留 `stats-core` 和组件测试为必跑。
- CI 不自动下载或修改 ZCode；集成安装必须由用户本机手动执行。
- 提供 `SECURITY.md`，说明补丁会修改本地 `app.asar` 和 `zcode.cjs`，以及备份/恢复方式。

## 4. 发布流程

1. `npm ci` / `pnpm install` 安装 `@electron/asar`、`acorn`。
2. 运行测试、语法检查、PowerShell 解析检查。
3. 构建便携 zip；不要把 `node_modules`、用户备份、日志放进 git。
4. GitHub Release 上传：
   - `ZCode-Token-Stats-<version>-win-x64.zip`
   - `*.sha256.txt`
   - 发行说明写清支持的 ZCode 版本、变更、已知限制、卸载方式。
5. 打 tag：`git tag v2.0.5 && git push origin v2.0.5`。
6. 首次公开前用另一个 Windows 用户账户或干净机器验证“卸载后完全恢复官方文件”。

## 5. 必须写进 README 的限制

- 仅 Windows + ZCode 桌面版，当前验证版本 `3.17.2`。
- 安装器会备份 `app.asar` 和 `zcode.cjs`；升级前完全退出 ZCode。
- 速度口径仍受 ZCode `generationDurationMs` 限制，不等同 Harness 首 Token 解码速度。
- 子代理、嵌套子代理、Workflow 用量依赖 ZCode 内部接口；接口改名时自动失败，不应强行安装。
- 缓存命中率由 ZCode 原生上下文面板展示，本插件不重复显示。
- 不收集遥测，不上传会话数据。

## 6. 建议仓库设置

- 开启 Issues，提供模板字段：ZCode 版本、`check.cmd` 输出、是否重启、错误日志。
- 开启 Discussions 用于兼容性反馈。
- Branch protection：主分支必须 PR + CI。
- Security advisory 私密报告渠道。
- Release 资产保留 SHA256；README 提供校验命令。

## 7. 不建议公开的内容

- 用户机器路径、用户名、会话 ID、附件、数据库、日志。
- `app.asar`、`zcode.cjs` 或任何官方二进制/反编译产物。
- `app.asar.before-*`、`zcode.cjs.before-token-stats-*` 等备份。
- 带个人令牌、API Key、Cookie、设备 ID 的文件。
