import type { RecordedMessage, FilterRules, FilterScript } from '../../types';

/** 编译 CLI 传入的过滤表达式：支持 `/pattern/flags` 写法，否则整串作为 pattern（无 flags） */
export function compileFilterPattern(input: string): RegExp {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(input);
  if (m) return new RegExp(m[1], m[2]);
  return new RegExp(input);
}

function matchAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(value));
}

async function applyScript(messages: RecordedMessage[], script: FilterScript): Promise<RecordedMessage[]> {
  if (typeof script === 'function') {
    const kept: RecordedMessage[] = [];
    for (const msg of messages) {
      if (await script(msg)) kept.push(msg);
    }
    return kept;
  }
  return script.batch(messages);
}

/**
 * 过滤管线：text 正则（剔除）→ user 正则（剔除）→ script hook。
 * 只在 convert 时执行，原始录制文件永远保持完整。
 */
export async function applyFilters(
  messages: RecordedMessage[],
  rules: FilterRules,
): Promise<RecordedMessage[]> {
  let result = messages;

  if (rules.text && rules.text.length > 0) {
    const text = rules.text;
    result = result.filter((m) => typeof m.txt !== 'string' || !matchAny(m.txt, text));
  }
  if (rules.user && rules.user.length > 0) {
    const user = rules.user;
    result = result.filter((m) => typeof m.nn !== 'string' || !matchAny(m.nn, user));
  }
  if (rules.script) {
    result = await applyScript(result, rules.script);
  }
  return result;
}
