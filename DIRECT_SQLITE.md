# Direct SQLite 数据层分支

这个分支用于验证 v2.0 的只读 SQLite 架构，**不影响 main 的 v1.0.0 稳定线**。

## 已实现

- `src/sqlite-usage.cjs`
  - `node:sqlite` 只读打开 `~/.zcode/cli/db/db.sqlite`
  - 会话累计、请求数、输入/输出/缓存读取/缓存写入
  - TTFT 平均值与样本数
  - 上下文已用/窗口/占比
  - 今日汇总
  - 按 `session.directory` 的项目累计
  - 子代理单独计入项目汇总，主会话与子代理分别保留
- `src/main-loader.cjs`
  - Electron 主进程 loader
  - 监听 `db.sqlite` / `-wal` / `-shm`
  - 通过 `webContents.executeJavaScript` 向渲染层派发 `ztsSnapshot` CustomEvent
  - 不需要 Python 常驻进程
- `src/patch-loader.cjs`
  - 向 `out/main/index.js` 追加/移除一行动态 import
  - 无完整 `app.asar` 备份；只删除自己的 loader 行
  - 兼容其它工具追加的 loader
- `src/apply-main.cjs`
  - 临时目录解包/重打包 app.asar
  - 只替换主入口文件，失败时原包未被覆盖
  - 验证后直接替换，不写 `app.asar.before-*`
- `renderer-direct-component.txt`
  - 两个胶囊改为监听 `ztsSnapshot`
  - 活动面板：模型用时、工具调用用时、TTFT、输出速度（TPS）
  - 用量面板：输入、缓存读取、缓存写入、输出、今日、项目、上下文
- `tests/test-sqlite-usage.cjs`
- `tests/test-loader-patch.cjs`
- `tests/test-apply-main.cjs`
- `tests/test-direct-renderer.cjs`

## 真实数据库验证

使用本机 `~/.zcode/cli/db/db.sqlite`：

```json
{
  "sessionRequests": 94,
  "ttftMs": 3061,
  "ttftSamples": 65,
  "context": {
    "used": 162231,
    "window": 1000000,
    "ratio": 0.162231
  },
  "projectRequests": 991,
  "projectTotal": 240047464
}
```

## 真实 asar 副本验证

已复制完整 `app.asar` + `app.asar.unpacked` 到测试目录，执行：

```powershell
$env:ZTS_DIRECT='1'
$env:ZTS_LOADER='...\src\main-loader.cjs'
node patch.js apply "%TEMP%\test-direct-app.asar"
node patch.js check "%TEMP%\test-direct-app.asar"
node patch.js remove "%TEMP%\test-direct-app.asar"
```

结果：

- apply 后 `patched: true`
- remove 后 `patched: false`
- 没有生成 `app.asar.before-*`
- 主入口和 renderer 双向验证通过
- `.unpacked` 原生文件必须与 asar 一起复制，否则 asar 解包会失败

## 尚未接入

1. 把 `ZTS_DIRECT` loader 模式接进正式安装器（复制运行时、设置环境、调用 patch.js）。
2. 真实 ZCode 进程启动 loader、UI 收到 `ztsSnapshot` 的端到端测试。
3. 上下文窗口原生按钮解析、子代理/Workflow 归属和去重。
4. ZCode 更新后 loader 自动恢复/卸载策略。
5. 打包和签名前的用户可见安装流程。

## 数据口径

- `input_tokens` 已包含缓存读取/写入，`total = input + output`
- `uncached = input - cacheRead - cacheWrite`
- TTFT 只统计 `time_to_first_token_ms > 0` 的请求
- 上下文 used 取最近一条 `model_usage.input_tokens`
- 今日按本地时区 `[00:00, 次日00:00)` 过滤
- 项目累计按 `session.directory` 精确匹配

## 测试

```powershell
node tests/test-sqlite-usage.cjs
node tests/test-loader-patch.cjs
node --check src/main-loader.cjs
```

## 下一步建议

先完成 asar loader 注入 + 单个会话的渲染桥接，确认：

- ZCode 更新覆盖 `app.asar` 后只重新注入 loader
- 卸载只移除 loader 行
- 不再生成 341MB 备份
- TTFT、上下文、今日/项目累计与 SQLite 对账一致

## 2.0 direct 包

安装器会把运行时复制到 `%LOCALAPPDATA%\ZCodeTokenStats\direct`，安装后主入口加载该目录的 `main-loader.cjs`。不再修改 `zcode.cjs`，也不再生成 `app.asar` 完整备份。
