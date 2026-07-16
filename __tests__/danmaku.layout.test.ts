import { estimateTextWidth, layoutDanmaku } from '../src/core/danmaku';
import type { LayoutConfig } from '../src/types';

const config: LayoutConfig = { width: 1920, height: 1080, fontSize: 48, duration: 12 };

// ─── estimateTextWidth ───────────────────────────────────────────────────────

describe('estimateTextWidth', () => {
  it('counts ASCII as 0.5 em', () => {
    expect(estimateTextWidth('abcd', 48)).toBe(2 * 48);
  });

  it('counts CJK as 1 em', () => {
    expect(estimateTextWidth('主播好帅', 48)).toBe(4 * 48);
  });

  it('mixes ASCII and CJK', () => {
    expect(estimateTextWidth('666哈哈', 48)).toBe((1.5 + 2) * 48);
  });

  it('counts astral-plane emoji as 1 em (code point, not surrogate pair)', () => {
    expect(estimateTextWidth('😀', 48)).toBe(48);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTextWidth('', 48)).toBe(0);
  });
});

// ─── layoutDanmaku ───────────────────────────────────────────────────────────

describe('layoutDanmaku', () => {
  it('returns empty for empty input', () => {
    expect(layoutDanmaku([], config)).toEqual([]);
  });

  it('positions a single danmaku on row 0 scrolling right to left', () => {
    const [d] = layoutDanmaku([{ start: 5, text: '哈哈' }], config);
    expect(d).toEqual({
      start: 5,
      end: 17,
      text: '哈哈',
      width: 96,
      x1: 1920,
      x2: -96,
      y: 0,
    });
  });

  it('stacks near-simultaneous danmaku on different rows', () => {
    const items = [
      { start: 0, text: '第一条弹幕' },
      { start: 0.1, text: '第二条弹幕' },
      { start: 0.2, text: '第三条弹幕' },
    ];
    const [a, b, c] = layoutDanmaku(items, config);
    expect(a.y).toBe(0);
    expect(b.y).toBe(48);
    expect(c.y).toBe(96);
  });

  it('reuses row 0 when the previous danmaku no longer collides', () => {
    const items = [
      { start: 0, text: '前面的弹幕' },
      { start: 11, text: '后面的弹幕' }, // 前一条 12s 离场，11s 时尾部早已进屏且追不上
    ];
    const [, later] = layoutDanmaku(items, config);
    expect(later.y).toBe(0);
  });

  it('does not reuse a row while the previous tail is still off-screen right', () => {
    // 超长文本进屏慢：尾部完全进屏需要 width_text / speed 秒
    const long = '弹'.repeat(100); // 4800px, speed=(1920+4800)/12=560px/s → 尾部进屏需 ~8.6s
    const items = [
      { start: 0, text: long },
      { start: 1, text: '短' },
    ];
    const [, short] = layoutDanmaku(items, config);
    expect(short.y).toBe(48);
  });

  it('avoids rows where a fast follower would catch up before the slow one exits', () => {
    // 前一条短而慢，后一条长而快：碰撞检查 prev.end - width/speed
    const items = [
      { start: 0, text: '短' },
      { start: 3, text: '这是一条特别特别特别特别特别特别特别特别长的弹幕' },
    ];
    const [, fast] = layoutDanmaku(items, config);
    expect(fast.y).toBe(48);
  });

  it('falls back to the earliest-free row when all rows are busy', () => {
    const tiny: LayoutConfig = { width: 100, height: 20, fontSize: 10, duration: 10 };
    // height/fontSize = 2 行，塞 3 条同时出现的弹幕
    const items = [
      { start: 0, text: 'aaaa' },
      { start: 0, text: 'bbbb' },
      { start: 0, text: 'cccccccc' },
    ];
    const placed = layoutDanmaku(items, tiny);
    expect(placed).toHaveLength(3); // 不丢弃
    expect(placed[2].y === 0 || placed[2].y === 10).toBe(true);
  });

  it('guarantees at least one row even when fontSize > height', () => {
    const cramped: LayoutConfig = { width: 100, height: 10, fontSize: 48, duration: 10 };
    const placed = layoutDanmaku([{ start: 0, text: 'x' }], cramped);
    expect(placed[0].y).toBe(0);
  });

  it('sorts by start time before allocating', () => {
    const items = [
      { start: 5, text: '后来的' },
      { start: 0, text: '先来的' },
    ];
    const placed = layoutDanmaku(items, config);
    expect(placed[0].text).toBe('先来的');
    expect(placed[1].text).toBe('后来的');
  });
});
