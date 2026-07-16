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
- 只往文件末尾追加、不回头改写，程序中途崩溃最多损失正在写的最后一行；解析时无法解析的行跳过并计数，不中断。

## convert 时间换算

- 字幕时间轴的第 0 秒 = meta 的 `startedAt`（录制开始那一刻）；`--delay <秒>`（可为负）把全部字幕整体提前或推后。
- `--from`/`--to` 只保留这段时间内的弹幕，接受 `HH:MM:SS(.mmm)`、`MM:SS`、纯秒数。

## 过滤（convert 时执行，原始录制文件永远完整）

按以下顺序依次过滤：`--filter`（正则匹配弹幕内容 txt，可重复，支持 `/pattern/flags` 写法）→ `--filter-user`（正则匹配昵称 nn）→ `--filter-script <path>`。

filter-script 为 ESM/CJS 模块，default export 二选一：
- `(msg: RecordedMessage) => boolean | Promise<boolean>` — 逐条，true 保留
- `{ batch: (msgs: RecordedMessage[]) => Promise<RecordedMessage[]> }` — 批量，返回保留集（LLM 批量判定用这个）

## 滚动轨道分配（layout.ts）

做法和 danmaku2ass 相同。屏幕按字号高度分成若干行（轨道），每条弹幕从右向左匀速滚动，滚完一条用固定的 `duration` 秒（默认 12s）。新弹幕放进第一条"不会和前一条撞上"的轨道，判断标准两条：前一条的尾巴已经完全滚进屏幕（新弹幕出现时不会叠在它尾巴上），并且新弹幕更快也追不上它。所有轨道都撞就放进最早腾出来的那条——宁可视觉上重叠，也不丢弃弹幕。文字宽度按"汉字等全角算 1 个字号宽、字母数字算半个"估算。

## ASS 输出

`[Script Info]`（PlayResX/Y 默认 1920×1080）+ `[V4+ Styles]` 单一 Danmaku 样式 + `[Events]` `Dialogue: 0,<start>,<end>,Danmaku,,0,0,0,,{\move(x1,y,x2,y)}<text>`。文本转义：`\` `{` `}` 与换行。样式可调项走 CLI options（fontsize/duration/opacity 等），不做配置文件。

## CLI 形态

```
douyudm -i 9999 [--record out.jsonl] [--record-events chatmsg,uenter]   # 默认命令，完全兼容
douyudm convert <input.jsonl> [-o out.ass] [--from/--to/--delay]
                [--filter <re>]... [--filter-user <re>] [--filter-script <path>]
                [--width/--height/--fontsize/--duration/--opacity]
```

实现要点：`-i` 不能再声明成 commander 的 `requiredOption`（否则运行 `douyudm convert` 也会因为缺 `-i` 报错），改为普通 option，在默认命令的处理函数里自己检查、缺了报和旧版一样的错误文案；录制时按 Ctrl+C 先把缓冲区数据写完再退出，不丢尾部弹幕。
