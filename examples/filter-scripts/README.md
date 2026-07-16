# 过滤脚本示例

`douyudm convert` 的 `--filter-script <path>` 支持自定义过滤逻辑，模块 default export 二选一：

| 形态 | 签名 | 适用场景 |
|------|------|----------|
| 逐条判定 | `(msg) => boolean \| Promise<boolean>`，true 保留 | 本地规则、简单逻辑 |
| 批量判定 | `{ batch: async (msgs) => 保留的子集 }` | 大模型/本地模型一次判定几百条 |

`msg` 是录制的 `RecordedMessage`：`{ ts, type, txt, nn, ...原始 STT 字段 }`。

## 示例

```shell
# 逐条：剔除纯数字刷屏
douyudm convert live.jsonl --filter-script ./simple.mjs

# 批量：用 Claude 判定机器人弹幕（需要 ANTHROPIC_API_KEY）
npm install @anthropic-ai/sdk
douyudm convert live.jsonl --filter-script ./llm-bot-filter.mjs
```

注意：过滤只发生在 convert 阶段，原始 JSONL 录制永远完整，可反复用不同过滤条件重新导出。
