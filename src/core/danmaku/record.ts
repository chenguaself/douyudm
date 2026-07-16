import type {
  RecordMeta,
  RecordedMessage,
  ParsedRecord,
  ConvertWindow,
  DanmakuItem,
} from '../../types';

export const RECORD_META_TAG = 'douyudm-record';
export const RECORD_VERSION = 1;

export function createRecordMeta(rid: string | number, startedAt: number): RecordMeta {
  return { __meta: RECORD_META_TAG, version: RECORD_VERSION, rid: String(rid), startedAt };
}

/** 一条记录（meta 或消息）→ 一行 JSONL（含换行符） */
export function serializeRecordLine(value: RecordMeta | RecordedMessage): string {
  return JSON.stringify(value) + '\n';
}

/** 解析整个 JSONL 录制文件。坏行跳过并计数，不中断（崩溃时最后一行可能不完整） */
export function parseRecord(content: string): ParsedRecord {
  let meta: RecordMeta | null = null;
  const messages: RecordedMessage[] = [];
  let badLines = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      badLines++;
      continue;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      badLines++;
      continue;
    }

    const rec = obj as Record<string, unknown>;
    if (rec.__meta === RECORD_META_TAG) {
      // 只认第一条 meta；文件拼接产生的后续 meta 行忽略
      if (meta === null) meta = rec as unknown as RecordMeta;
      continue;
    }
    if (typeof rec.ts !== 'number' || typeof rec.type !== 'string') {
      badLines++;
      continue;
    }
    messages.push(rec as RecordedMessage);
  }

  return { meta, messages, badLines };
}

/** 解析 CLI 时间参数：纯秒数（可带小数）、MM:SS、HH:MM:SS → 秒 */
export function parseTimeParam(input: string): number {
  const parts = String(input).trim().split(':');
  const last = parts[parts.length - 1];
  const valid =
    parts.length <= 3 &&
    /^\d+(\.\d+)?$/.test(last) &&
    parts.slice(0, -1).every((p) => /^\d+$/.test(p));
  if (!valid) throw new Error(`无法解析的时间参数: ${input}`);

  const nums = parts.map(Number);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] >= 60) throw new Error(`时间参数分/秒需小于 60: ${input}`);
  }
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** 应用时间窗口，把录制消息换算成相对字幕 0 点的弹幕条目（无 txt 的消息跳过） */
export function toDanmakuItems(messages: RecordedMessage[], window: ConvertWindow): DanmakuItem[] {
  const { zeroAt, from, to, delay = 0 } = window;
  const items: DanmakuItem[] = [];

  for (const m of messages) {
    if (typeof m.txt !== 'string' || m.txt === '') continue;
    const rel = (m.ts - zeroAt) / 1000;
    if (from !== undefined && rel < from) continue;
    if (to !== undefined && rel > to) continue;
    const start = rel - (from ?? 0) + delay;
    // 负 delay 把消息平移到视频开始之前：没有可显示的时间点，丢弃
    if (start < 0) continue;
    items.push({ start, text: m.txt });
  }
  return items;
}
