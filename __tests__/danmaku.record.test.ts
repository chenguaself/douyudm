import {
  RECORD_META_TAG,
  RECORD_VERSION,
  createRecordMeta,
  serializeRecordLine,
  parseRecord,
  parseTimeParam,
  toDanmakuItems,
} from '../src/core/danmaku';
import type { RecordedMessage } from '../src/types';

const msg = (ts: number, txt?: string): RecordedMessage => ({
  ts,
  type: 'chatmsg',
  ...(txt !== undefined ? { txt } : {}),
});

// ─── createRecordMeta / serializeRecordLine ──────────────────────────────────

describe('createRecordMeta', () => {
  it('creates meta with tag/version and stringified rid', () => {
    expect(createRecordMeta(102965, 1700000000000)).toEqual({
      __meta: RECORD_META_TAG,
      version: RECORD_VERSION,
      rid: '102965',
      startedAt: 1700000000000,
    });
  });
});

describe('serializeRecordLine', () => {
  it('serializes one JSON line with trailing newline', () => {
    expect(serializeRecordLine({ ts: 1, type: 'chatmsg', txt: '666' })).toBe(
      '{"ts":1,"type":"chatmsg","txt":"666"}\n',
    );
  });
});

// ─── parseRecord ─────────────────────────────────────────────────────────────

describe('parseRecord', () => {
  const meta = createRecordMeta('102965', 1000);

  it('round-trips meta + messages written by serializeRecordLine', () => {
    const content =
      serializeRecordLine(meta) +
      serializeRecordLine({ ts: 2000, type: 'chatmsg', txt: '注意保暖', nn: '小老弟233' }) +
      serializeRecordLine({ ts: 3000, type: 'uenter', nn: 'tiara佳尊' });
    const r = parseRecord(content);
    expect(r.meta).toEqual(meta);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0].txt).toBe('注意保暖');
    expect(r.messages[1].type).toBe('uenter');
    expect(r.badLines).toBe(0);
  });

  it('skips empty lines and whitespace-only lines', () => {
    const r = parseRecord('\n  \n' + serializeRecordLine(msg(1, 'a')) + '\n');
    expect(r.messages).toHaveLength(1);
    expect(r.badLines).toBe(0);
  });

  it('counts truncated/unparseable lines without aborting', () => {
    const content = serializeRecordLine(msg(1, 'a')) + '{"ts":2,"type":"chat';
    const r = parseRecord(content);
    expect(r.messages).toHaveLength(1);
    expect(r.badLines).toBe(1);
  });

  it('counts valid-JSON non-object lines', () => {
    const r = parseRecord('42\nnull\n[]\n');
    expect(r.messages).toHaveLength(0);
    expect(r.badLines).toBe(3);
  });

  it('keeps the first meta and ignores later meta lines (file concat)', () => {
    const meta2 = createRecordMeta('999', 5000);
    const r = parseRecord(serializeRecordLine(meta) + serializeRecordLine(meta2));
    expect(r.meta).toEqual(meta);
    expect(r.badLines).toBe(0);
  });

  it('counts message lines missing ts or type', () => {
    const r = parseRecord('{"type":"chatmsg","txt":"a"}\n{"ts":1,"txt":"b"}\n');
    expect(r.messages).toHaveLength(0);
    expect(r.badLines).toBe(2);
  });

  it('returns null meta when absent', () => {
    const r = parseRecord(serializeRecordLine(msg(1, 'a')));
    expect(r.meta).toBeNull();
  });
});

// ─── parseTimeParam ──────────────────────────────────────────────────────────

describe('parseTimeParam', () => {
  it('parses pure seconds, with decimals', () => {
    expect(parseTimeParam('90')).toBe(90);
    expect(parseTimeParam('90.5')).toBe(90.5);
    expect(parseTimeParam(' 90 ')).toBe(90);
  });

  it('parses MM:SS', () => {
    expect(parseTimeParam('1:30')).toBe(90);
    expect(parseTimeParam('10:05.5')).toBe(605.5);
  });

  it('parses HH:MM:SS', () => {
    expect(parseTimeParam('1:00:00')).toBe(3600);
    expect(parseTimeParam('2:03:04')).toBe(7384);
  });

  it('rejects more than 3 parts', () => {
    expect(() => parseTimeParam('1:2:3:4')).toThrow('无法解析');
  });

  it('rejects non-numeric input', () => {
    expect(() => parseTimeParam('abc')).toThrow('无法解析');
    expect(() => parseTimeParam('1:xx')).toThrow('无法解析');
  });

  it('rejects decimals in hour/minute parts', () => {
    expect(() => parseTimeParam('1.5:30')).toThrow('无法解析');
  });

  it('rejects minute/second parts >= 60', () => {
    expect(() => parseTimeParam('1:75')).toThrow('小于 60');
    expect(() => parseTimeParam('1:99:00')).toThrow('小于 60');
  });
});

// ─── toDanmakuItems ──────────────────────────────────────────────────────────

describe('toDanmakuItems', () => {
  it('converts ts to seconds relative to zeroAt', () => {
    expect(toDanmakuItems([msg(11500, '666')], { zeroAt: 10000 })).toEqual([
      { start: 1.5, text: '666' },
    ]);
  });

  it('skips messages without txt or with empty txt', () => {
    expect(toDanmakuItems([msg(11000), msg(12000, ''), msg(13000, 'ok')], { zeroAt: 10000 })).toEqual([
      { start: 3, text: 'ok' },
    ]);
  });

  it('clips with from/to and re-zeros the subtitle to from', () => {
    const messages = [msg(10000, 'early'), msg(70000, 'in'), msg(200000, 'late')];
    expect(toDanmakuItems(messages, { zeroAt: 0, from: 60, to: 120 })).toEqual([
      { start: 10, text: 'in' },
    ]);
  });

  it('applies positive delay', () => {
    expect(toDanmakuItems([msg(1000, 'a')], { zeroAt: 0, delay: 2 })).toEqual([
      { start: 3, text: 'a' },
    ]);
  });

  it('drops items shifted before 0 by negative delay', () => {
    expect(toDanmakuItems([msg(1000, 'a'), msg(5000, 'b')], { zeroAt: 0, delay: -3 })).toEqual([
      { start: 2, text: 'b' },
    ]);
  });
});
