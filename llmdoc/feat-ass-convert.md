# feat: 弹幕录制 + ASS 字幕导出

分支 `feat/ass-convert`。需求源自 issue #40 的评论讨论（issue 正文已被清空，不跟踪 issue 本身）：录制直播弹幕，事后导出 ASS 字幕，配合录播视频挂载。

## 已定决策（用户确认，勿改）

1. **CLI 用默认子命令**保持兼容：`douyudm -i 9999` 行为不变，新增 `douyudm convert` 子命令。不用 `douyudm convert ass <start> <end>` 这种位置参数形态。
2. **默认只录 `chatmsg`**，其他事件通过 `--record-events` 扩展。
3. **v1 只做滚动弹幕**（ASS `\move`），不做礼物/顶部/底部字幕。
4. **不内置机器人识别**（客户端只是接收方，无法验证），但提供通用过滤：正则 + 可编程 hook（用户可自行接大模型/本地模型）。

## 分层

| 位置 | 内容 | 约束 |
|------|------|------|
| `src/core/danmaku/record.ts` | JSONL 行解析、时间参数解析 | 纯逻辑，100% 覆盖 |
| `src/core/danmaku/filter.ts` | 正则编译、过滤管线（支持异步 hook） | 纯逻辑，100% 覆盖 |
| `src/core/danmaku/layout.ts` | 文本宽度估算、滚动轨道分配 | 纯函数，100% 覆盖 |
| `src/core/danmaku/ass.ts` | ASS 文本渲染 | 纯函数，100% 覆盖 |
| `src/cli/cmd.ts` | 录制落盘、`--filter-script` 动态加载、convert 编排 | Node-only，不计覆盖 |

core 层不碰 fs/net，浏览器可用；类型进 `src/types/index.ts`；从 `src/index.ts` 与两个 platform 入口导出。

## 录制格式（JSONL）

- 文件第 1 行为 meta：`{"__meta":"douyudm-record","version":1,"rid":"9999","startedAt":<epoch ms>}`
- 之后每行一条消息：`{"ts":<epoch ms>, ...完整 STT 对象}`（`ts` 为收到时刻）
- append-only，崩溃安全；解析时坏行跳过并计数，不中断。

## convert 时间模型

- 字幕 0 点 = meta `startedAt`（即录制开始）；`--delay <秒>`（可负）整体平移。
- `--from`/`--to` 裁剪，接受 `HH:MM:SS(.mmm)`、`MM:SS`、纯秒数。

## 过滤管线（convert 时执行，原始录制永远完整）

顺序：`--filter`（正则匹配 txt，可重复，支持 `/pattern/flags` 写法）→ `--filter-user`（正则匹配 nn）→ `--filter-script <path>`。

filter-script 为 ESM/CJS 模块，default export 二选一：
- `(msg: RecordedMessage) => boolean | Promise<boolean>` — 逐条，true 保留
- `{ batch: (msgs: RecordedMessage[]) => Promise<RecordedMessage[]> }` — 批量，返回保留集（LLM 批量判定用这个）

## 滚动轨道分配（layout.ts）

danmaku2ass 风格：屏幕按行高分轨；弹幕从右向左匀速，`duration` 固定（默认 12s）；新弹幕挑第一条满足"前一条已完全离开右边缘，且在其消失前追不上"的轨道，全忙则挑最早空闲的轨（允许重叠，不丢弃）。宽度估算：CJK 记 1 em、ASCII 记 0.5 em × fontSize。

## ASS 输出

`[Script Info]`（PlayResX/Y 默认 1920×1080）+ `[V4+ Styles]` 单一 Danmaku 样式 + `[Events]` `Dialogue: 0,<start>,<end>,Danmaku,,0,0,0,,{\move(x1,y,x2,y)}<text>`。文本转义：`\` `{` `}` 与换行。样式可调项走 CLI options（fontsize/duration/opacity 等），不做配置文件。

## CLI 形态

```
douyudm -i 9999 [--record out.jsonl] [--record-events chatmsg,uenter]   # 默认命令，完全兼容
douyudm convert <input.jsonl> [-o out.ass] [--from/--to/--delay]
                [--filter <re>]... [--filter-user <re>] [--filter-script <path>]
                [--width/--height/--fontsize/--duration/--opacity]
```

实现要点：`-i` 从 `requiredOption` 降为 program 级普通 option + 默认 action 内手动校验（否则 `douyudm convert` 会因缺 `-i` 报错）；录制时 SIGINT 先 flush 再退出。
