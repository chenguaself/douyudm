import { ASS_DEFAULTS, formatAssTime, escapeAssText, renderAss } from '../src/core/danmaku';

// ─── formatAssTime ───────────────────────────────────────────────────────────

describe('formatAssTime', () => {
  it('formats zero', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00');
  });

  it('formats H:MM:SS.cc with centiseconds', () => {
    expect(formatAssTime(3661.25)).toBe('1:01:01.25');
  });

  it('clamps negative to zero', () => {
    expect(formatAssTime(-5)).toBe('0:00:00.00');
  });

  it('carries over when centiseconds round to 100', () => {
    expect(formatAssTime(59.999)).toBe('0:01:00.00');
  });

  it('does not pad hours', () => {
    expect(formatAssTime(36000)).toBe('10:00:00.00');
  });
});

// ─── escapeAssText ───────────────────────────────────────────────────────────

describe('escapeAssText', () => {
  it('escapes backslash, braces and newlines', () => {
    expect(escapeAssText('a\\b{c}d\ne\r\nf')).toBe('a\\\\b\\{c\\}d\\ne\\nf');
  });

  it('leaves plain text untouched', () => {
    expect(escapeAssText('主播好帅666')).toBe('主播好帅666');
  });
});

// ─── renderAss ───────────────────────────────────────────────────────────────

describe('renderAss', () => {
  it('renders a complete document with defaults', () => {
    const ass = renderAss([{ start: 1.5, text: '注意保暖' }]);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain(`PlayResX: ${ASS_DEFAULTS.width}`);
    expect(ass).toContain(`PlayResY: ${ASS_DEFAULTS.height}`);
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain(`Style: Danmaku,${ASS_DEFAULTS.fontName},${ASS_DEFAULTS.fontSize},`);
    expect(ass).toContain('[Events]');
    expect(ass).toContain(
      'Dialogue: 0,0:00:01.50,0:00:13.50,Danmaku,,0,0,0,,{\\move(1920,0,-192,0)}注意保暖',
    );
    expect(ass.endsWith('\n')).toBe(true);
  });

  it('renders no Dialogue lines for empty input', () => {
    const ass = renderAss([]);
    expect(ass).toContain('[Events]');
    expect(ass).not.toContain('Dialogue:');
  });

  it('respects custom size/font/duration options', () => {
    const ass = renderAss([{ start: 0, text: 'hi' }], {
      width: 1280,
      height: 720,
      fontSize: 36,
      fontName: 'Arial',
      duration: 8,
    });
    expect(ass).toContain('PlayResX: 1280');
    expect(ass).toContain('PlayResY: 720');
    expect(ass).toContain('Style: Danmaku,Arial,36,');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:08.00,');
    expect(ass).toContain('{\\move(1280,0,-36,0)}hi');
  });

  it('maps opacity to ASS alpha channel', () => {
    // opacity 0.8 → alpha (1-0.8)*255 = 51 → 0x33
    expect(renderAss([])).toContain('&H33FFFFFF');
    // 全透明/不透明 + 越界 clamp
    expect(renderAss([], { opacity: 0 })).toContain('&HFFFFFFFF');
    expect(renderAss([], { opacity: 1 })).toContain('&H00FFFFFF');
    expect(renderAss([], { opacity: 5 })).toContain('&H00FFFFFF');
    expect(renderAss([], { opacity: -1 })).toContain('&HFFFFFFFF');
  });

  it('escapes ASS control characters in danmaku text', () => {
    const ass = renderAss([{ start: 0, text: '{\\pos}' }]);
    expect(ass).toContain('}\\{\\\\pos\\}');
  });

  it('stacks simultaneous danmaku on separate rows in output', () => {
    const ass = renderAss([
      { start: 0, text: '一' },
      { start: 0, text: '二' },
    ]);
    expect(ass).toContain(`{\\move(1920,0,`);
    expect(ass).toContain(`{\\move(1920,${ASS_DEFAULTS.fontSize},`);
  });
});
