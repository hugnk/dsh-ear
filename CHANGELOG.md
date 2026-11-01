# Changelog

## 0.1.1

- 修复：`install.ps1` 在 Windows PowerShell 5.1 下用 `Set-Content -Encoding UTF8` 写 profile 的 `package.json`，会带 UTF-8 BOM；DSH 重启后可能拒绝加载 `dsh-ear`，表现为 8788 不监听、QQ 侧说“今天一条没收到”。
- 安装脚本改为无 BOM 的 UTF-8 写入，并在安装时自动去掉插件自带 `package.json` 的 BOM；卸载脚本同步修正。
- 新增 `scripts/check-no-bom.mjs` 和 GitHub Actions 检查：`package.json`、`cordis.patch.yml`、脚本、源码都不允许带 BOM。
- 清掉 `src/reminders.js`、`test/plugin.test.mjs` 里遗留的 BOM。

## 0.1.0

- 第一个版本：独立接收录音豆推来的转写（v1 + 旧格式），自己开端口、自己存、去重、过期清理。
- 自动往 aurabot 里安装 QQ 侧模块：只读工具 `ear`、可选私聊上下文、到点提醒。
- `/ear` 命令：地址、token、条数、开关提醒。
- 32 项离线自测（协议 / 去重 / 提醒 / HTTP / 模块 / 宿主）。
