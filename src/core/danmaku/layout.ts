import type { DanmakuItem, LayoutConfig, PositionedDanmaku } from '../../types';

/** 估算文本渲染宽度：码点 > 0xFF（CJK/全角/emoji）记 1 em，其余记 0.5 em */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    // for-of 按码点迭代，ch 恒非空，codePointAt(0) 恒有值
    em += (ch.codePointAt(0) as number) > 0xff ? 1 : 0.5;
  }
  return em * fontSize;
}

/**
 * 滚动弹幕轨道分配（danmaku2ass 风格）。
 * 弹幕以 (width + 文本宽) / duration 的速度从右向左匀速滚动；
 * 轨道可复用需同时满足：前一条尾部已完全进屏，且新弹幕头部在前一条离场前追不到左边缘。
 * 全部轨道冲突时挑最早空闲的轨（允许视觉重叠，不丢弃弹幕）。
 * 坐标按 ASS \an7（左上角锚点）给出：x1=width 起、x2=-文本宽 止。
 */
export function layoutDanmaku(items: DanmakuItem[], config: LayoutConfig): PositionedDanmaku[] {
  const { width, height, fontSize, duration } = config;
  const rowHeight = fontSize;
  const rows = Math.max(1, Math.floor(height / rowHeight));
  const lastInRow: (PositionedDanmaku | undefined)[] = new Array(rows);

  // 轨道 row 对新弹幕（速度 speed）无碰撞可用的最早时刻
  const rowFreeAt = (row: number, speed: number): number => {
    const prev = lastInRow[row];
    if (!prev) return -Infinity;
    const prevSpeed = (width + prev.width) / duration;
    return Math.max(
      prev.start + prev.width / prevSpeed, // 前一条尾部完全进入屏幕
      prev.end - width / speed, // 新弹幕头部到达左边缘不早于前一条离场
    );
  };

  const sorted = [...items].sort((a, b) => a.start - b.start);
  const result: PositionedDanmaku[] = [];

  for (const item of sorted) {
    const w = estimateTextWidth(item.text, fontSize);
    const speed = (width + w) / duration;

    let row = -1;
    let earliestRow = 0;
    let earliestAt = Infinity;
    for (let i = 0; i < rows; i++) {
      const freeAt = rowFreeAt(i, speed);
      if (freeAt <= item.start) {
        row = i;
        break;
      }
      if (freeAt < earliestAt) {
        earliestAt = freeAt;
        earliestRow = i;
      }
    }
    if (row === -1) row = earliestRow;

    const positioned: PositionedDanmaku = {
      start: item.start,
      end: item.start + duration,
      text: item.text,
      width: w,
      x1: width,
      x2: -Math.round(w),
      y: row * rowHeight,
    };
    lastInRow[row] = positioned;
    result.push(positioned);
  }

  return result;
}
