/**
 * Packet.decode 对畸形/恶意帧的健壮性(2026-07 审查修复的回归测试)。
 * 已有 packet.test.ts 保持不动,这里只覆盖新增的防御分支。
 */
import { Packet } from '../src/core/packet';

function frame(body: string): ArrayBuffer {
  return Packet.encode(body);
}

function concatBuffers(...bufs: ArrayBuffer[]): ArrayBuffer {
  const total = bufs.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

function u32le(...values: number[]): ArrayBuffer {
  const dv = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((v, i) => dv.setUint32(i * 4, v, true));
  return dv.buffer;
}

describe('Packet.decode 畸形帧防御', () => {
  test('readLength=0 不产生任何回调且正常终止', () => {
    const cb = jest.fn();
    // 16 字节全 0:旧实现会每 4 字节吐一次垃圾回调
    Packet.decode(new ArrayBuffer(16), cb);
    expect(cb).not.toHaveBeenCalled();
  });

  test('readLength ∈ [1..8](装不下头部)整帧丢弃', () => {
    const cb = jest.fn();
    for (const len of [1, 4, 8]) {
      Packet.decode(u32le(len, 0, 0, 0), cb);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  test('readLength=9(空 body)回调空字符串', () => {
    const cb = jest.fn();
    // 4(len) + 9 字节:len2(4) + type(2) + enc(1) + 占位(1) + \0(1)
    const buf = concatBuffers(u32le(9), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer);
    Packet.decode(buf, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('');
  });

  test('截断帧(声明长度超过实际数据)丢弃不崩溃', () => {
    const cb = jest.fn();
    Packet.decode(u32le(100, 0), cb);
    expect(cb).not.toHaveBeenCalled();
  });

  test('尾部不足 4 字节读长度时正常终止', () => {
    const cb = jest.fn();
    const buf = concatBuffers(frame('type@=mrkl/'), new Uint8Array([1, 2]).buffer);
    Packet.decode(buf, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('type@=mrkl/');
  });

  test('粘包:多条合法消息全部解出', () => {
    const cb = jest.fn();
    Packet.decode(concatBuffers(frame('a@=1/'), frame('b@=2/'), frame('c@=3/')), cb);
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['a@=1/', 'b@=2/', 'c@=3/']);
  });

  test('合法消息后跟畸形帧:前者解出,后者丢弃', () => {
    const cb = jest.fn();
    Packet.decode(concatBuffers(frame('ok@=1/'), u32le(3, 0, 0)), cb);
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['ok@=1/']);
  });

  test('大量粘包解码为线性耗时(旧实现 O(n²) 会超时)', () => {
    const one = frame('type@=chatmsg/txt@=hello world/nn@=user/');
    const buf = concatBuffers(...Array.from({ length: 20000 }, () => one));
    const cb = jest.fn();
    Packet.decode(buf, cb);
    expect(cb).toHaveBeenCalledTimes(20000);
  });
});
