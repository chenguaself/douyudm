// 批量判定示例：用 Claude 一次判定几百条弹幕是否为机器人/广告，返回保留集合。
// 用法：
//   npm install @anthropic-ai/sdk
//   export ANTHROPIC_API_KEY=sk-ant-...
//   douyudm convert live.jsonl --filter-script ./llm-bot-filter.mjs
//
// convert 是离线批处理，对延迟不敏感，批量接口一次请求即可判完全部弹幕；
// 超大录制文件按 CHUNK 分批，避免单次请求过长。
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const CHUNK = 300;

async function classifyChunk(msgs) {
  const numbered = msgs.map((m, i) => `${i}\t${m.nn ?? ''}\t${m.txt}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system:
      '你是直播弹幕审核助手。输入为多行弹幕，每行格式 "序号\\t昵称\\t内容"。' +
      '判定每条是否为机器人/广告弹幕（引流、加群、代练、刷屏营销等）。' +
      '正常观众的刷梗、复读、表情不算机器人。',
    messages: [{ role: 'user', content: numbered }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            bots: {
              type: 'array',
              description: '判定为机器人/广告弹幕的序号列表',
              items: { type: 'integer' },
            },
          },
          required: ['bots'],
          additionalProperties: false,
        },
      },
    },
  });

  if (response.stop_reason === 'refusal') return msgs; // 分类被拒绝时保守放行
  const { bots } = JSON.parse(response.content.find((b) => b.type === 'text').text);
  const botSet = new Set(bots);
  return msgs.filter((_, i) => !botSet.has(i));
}

export default {
  batch: async (msgs) => {
    const kept = [];
    for (let i = 0; i < msgs.length; i += CHUNK) {
      kept.push(...(await classifyChunk(msgs.slice(i, i + CHUNK))));
      console.error(`[llm-filter] 已判定 ${Math.min(i + CHUNK, msgs.length)}/${msgs.length}`);
    }
    return kept;
  },
};
