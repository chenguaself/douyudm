/**
 * STT.deserialize 对恶意 key 的防御(2026-07 审查修复的回归测试)。
 * 已有 stt.test.ts 保持不动。
 */
import { STT } from '../src/core/stt';
import type { STTObject } from '../src/types';

describe('STT.deserialize 原型安全', () => {
  test('__proto__ 键(嵌套对象值)不改写消息对象原型', () => {
    const r = STT.deserialize('type@=x/__proto__@=polluted@=yes/') as STTObject;

    // 原型链未被劫持
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    // 全局 Object.prototype 未被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // 数据本身作为自有属性保留
    const desc = Object.getOwnPropertyDescriptor(r, '__proto__');
    expect(desc?.value).toEqual({ polluted: 'yes' });
    // 其余字段不受影响
    expect(r.type).toBe('x');
  });

  test('__proto__ 键(字符串值)同样作为自有属性', () => {
    const r = STT.deserialize('__proto__@=abc/') as STTObject;
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(r, '__proto__')?.value).toBe('abc');
  });

  test('constructor 键不影响对象行为', () => {
    const r = STT.deserialize('constructor@=evil/type@=x/') as STTObject;
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(r.constructor).toBe('evil'); // 自有属性遮蔽,仅限该对象
    expect(r.type).toBe('x');
  });

  test('重复 key 仍为后者覆盖(服务端 rid quirk 行为不变)', () => {
    const r = STT.deserialize('rid@=1/rid@=2/') as STTObject;
    expect(r.rid).toBe('2');
  });

  test('修复后属性仍可写可枚举(消费方可正常遍历/修改)', () => {
    const r = STT.deserialize('a@=1/b@=2/') as STTObject;
    expect(Object.keys(r)).toEqual(['a', 'b']);
    r.a = 'changed';
    expect(r.a).toBe('changed');
  });
});
