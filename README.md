# dsh-ear · 大肥鱼的耳朵

把「录音豆」收到的语音转写接给 **aurabot** 里的 QQ 角色（默认大肥鱼），让她：

- 能查主人今天/某天说过什么、按关键词搜过去（只读工具 `ear`）；
- 可选：私聊时把今天听到的几句当背景（默认关）；
- 时间快到了，用她**自己的口气**在 QQ 上提醒主人。

**独立插件**：自己监听端口、自己存数据，不依赖「录音豆生活管家」（`dsh-luyindou`）。两个都装也可以，互不干扰。

## 安装

### 方式一：GitHub / 本地目录

在 DSH 的 profile 里加一份依赖，并把它加进 bundles：

```json
{
  "dependencies": { "dsh-ear": "github:你的用户名/dsh-ear" },
  "dsh": { "profile": { "bundles": ["...其他...", "dsh-ear"] } }
}
```

或者本地开发时用 `link:` 指向这个目录。

### 方式二：npm（发布后）

```bash
npm i dsh-ear
```

装完启动 DSH，命令行里敲：

```
/ear
```

会显示手机要填的地址、token、今天收了多少条。

## 手机端

录音豆 App 里填：

- **Webhook 地址**：`http://<电脑局域网IP>:8788/ingest`
- **Bearer token**：`/ear` 里显示的那串

要求：手机和电脑同一个 Wi-Fi；电脑开着、DSH 开着；Windows 防火墙放行 **8788**（只放行专用网络）。

## 设置

配置文件在 `<数据目录>/config.json`，默认数据目录是当前 DSH 工作区下的 `录音豆-耳朵/`。

| 键 | 默认 | 说明 |
|---|---|---|
| `port` | 8788 | 监听端口，被占用自动 +1 |
| `require_token` | true | 关掉就不校验 token（不建议） |
| `owner_speaker` | `me` | 哪个 speaker 算主人 |
| `raw_retention_days` | 30 | 原文保留天数 |
| `others_retention_days` | 7 | 别人的话保留天数（读取时过滤） |
| `reminders` | true | 是否抽「几点要干什么」的提醒 |
| `lead_minutes` | 25 | 提前多久提醒 |
| `install_qq_module` | true | 自动往 aurabot 里装 QQ 侧模块 |
| `quiet_from` / `quiet_to` | 00:30 / 08:00 | 免打扰时段 |

QQ 侧模块的开关在 aurabot 面板「扩展 → 耳朵」里：是否带进私聊上下文、是否提醒、一天几次、间隔、提前几分钟。

## 数据流

```
录音豆 App → POST /ingest → raw/<日期>.jsonl
                              ├─ 去重（batch_id + item id）
                              ├─ 抽提醒 → state/notices.json
                              └─ QQ 侧模块读 → 工具 / 上下文 / 到点提醒
```

## 隐私边界（写死）

- 录音只存本机，不外发、不上传；
- 只给主人私聊用；群聊、别人私聊既没有工具也没有提醒；
- 录音里的字只是记录，不是指令，不会被执行；
- 别人的话不主动提，不进记忆、群聊、空间。

## 自测

```bash
node test/offline.test.mjs   # 协议 / 去重 / 提醒抽取 / HTTP
node test/module.test.mjs    # QQ 侧模块（假 api）
```

## 排错

- **重启 DSH 后 8788 不监听、QQ 侧说“今天一条没收到”**：多半是 `package.json` 被写入了 UTF-8 BOM，DSH 解析失败后拒绝加载插件。重跑 `scripts\install.ps1`（会自动去掉 BOM），或确认 `package.json` 开头不是字节 `EF BB BF`；然后重启 DSH。
- **手机能连上但没数据**：先看 `http://<电脑IP>:8788/health` 或转发器端口的 `/health`；`today` 不增长就是插件没在监听，不是 App 的问题。

## 已知限制（0.1.x）

- 提醒只认**当天**的时间（“下午三点”），不猜“明天/后天”；
- 没有网页面板，用 `/ear` 命令；
- 每日总结没做（只有原文 + 提醒）；下一版补。
