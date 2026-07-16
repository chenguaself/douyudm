import { compileFilterPattern, applyFilters } from '../src/core/danmaku';
import type { RecordedMessage } from '../src/types';

const msg = (txt: string, nn = 'user'): RecordedMessage => ({ ts: 0, type: 'chatmsg', txt, nn });

// ─── compileFilterPattern ────────────────────────────────────────────────────

describe('compileFilterPattern', () => {
  it('treats plain string as pattern without flags', () => {
    const re = compileFilterPattern('666+');
    expect(re.source).toBe('666+');
    expect(re.flags).toBe('');
  });

  it('parses /pattern/flags syntax', () => {
    const re = compileFilterPattern('/hello/i');
    expect(re.source).toBe('hello');
    expect(re.flags).toBe('i');
    expect(re.test('HELLO')).toBe(true);
  });

  it('supports empty flags in slash syntax', () => {
    const re = compileFilterPattern('/a.b/');
    expect(re.source).toBe('a.b');
    expect(re.flags).toBe('');
  });

  it('slash syntax pattern can contain slashes and newlines (s flag on outer parse)', () => {
    const re = compileFilterPattern('/a\\/b/');
    expect(re.test('a/b')).toBe(true);
  });
});

// ─── applyFilters ────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const messages = [msg('666', 'alice'), msg('主播好帅', 'bob'), msg('刷礼物抽奖', 'bot123')];

  it('returns input as-is with empty rules', async () => {
    expect(await applyFilters(messages, {})).toEqual(messages);
    expect(await applyFilters(messages, { text: [], user: [] })).toEqual(messages);
  });

  it('removes messages whose txt matches any text pattern', async () => {
    const kept = await applyFilters(messages, { text: [/666/, /抽奖/] });
    expect(kept.map((m) => m.txt)).toEqual(['主播好帅']);
  });

  it('keeps messages without txt when text rules present', async () => {
    const noTxt: RecordedMessage = { ts: 0, type: 'uenter', nn: 'x' };
    const kept = await applyFilters([noTxt], { text: [/.*/] });
    expect(kept).toEqual([noTxt]);
  });

  it('removes messages whose nn matches any user pattern', async () => {
    const kept = await applyFilters(messages, { user: [/^bot/] });
    expect(kept.map((m) => m.nn)).toEqual(['alice', 'bob']);
  });

  it('keeps messages without nn when user rules present', async () => {
    const noNn: RecordedMessage = { ts: 0, type: 'chatmsg', txt: 'hi' };
    const kept = await applyFilters([noNn], { user: [/.*/] });
    expect(kept).toEqual([noNn]);
  });

  it('applies predicate script (sync), true keeps', async () => {
    const kept = await applyFilters(messages, { script: (m) => m.txt !== '666' });
    expect(kept.map((m) => m.txt)).toEqual(['主播好帅', '刷礼物抽奖']);
  });

  it('applies predicate script (async)', async () => {
    const kept = await applyFilters(messages, {
      script: async (m) => Promise.resolve(m.nn === 'alice'),
    });
    expect(kept.map((m) => m.nn)).toEqual(['alice']);
  });

  it('applies batch script returning the kept subset', async () => {
    const kept = await applyFilters(messages, {
      script: { batch: async (msgs) => msgs.filter((m) => m.txt === '主播好帅') },
    });
    expect(kept.map((m) => m.txt)).toEqual(['主播好帅']);
  });

  it('chains text → user → script in order', async () => {
    const calls: string[] = [];
    const kept = await applyFilters(messages, {
      text: [/抽奖/],
      user: [/alice/],
      script: (m) => {
        calls.push(String(m.txt));
        return true;
      },
    });
    // text 剔除"刷礼物抽奖"，user 剔除 alice，script 只看到剩下的 bob
    expect(calls).toEqual(['主播好帅']);
    expect(kept.map((m) => m.txt)).toEqual(['主播好帅']);
  });
});
