import type { PacketDecodeCallback } from '../types';

const HEADER_LEN_SIZE = 4;
const HEADER_LEN_TYPECODE = 2;
const HEADER_LEN_ENCRYPT = 1;
const HEADER_LEN_PLACEHOLDER = 1;
const HEADER_LEN_TOTAL =
  HEADER_LEN_SIZE * 2 + HEADER_LEN_TYPECODE + HEADER_LEN_ENCRYPT + HEADER_LEN_PLACEHOLDER;

function concat(...bufs: Uint8Array[]): Uint8Array {
  const totalLen = bufs.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of bufs) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

// Normalize any buffer-like input (ArrayBuffer, Buffer, Uint8Array, etc.) to ArrayBuffer
function toArrayBuffer(input: unknown): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  // Handle Node.js Buffer / any ArrayBufferView (Uint8Array, DataView, etc.)
  const view = input as ArrayBufferView;
  return (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export class Packet {
  static encode(data: string): ArrayBuffer {
    const encoder = new TextEncoder();
    const body = concat(encoder.encode(data), Uint8Array.of(0));
    const messageLength = body.length + HEADER_LEN_SIZE * 2;
    const dv = new DataView(new ArrayBuffer(body.length + HEADER_LEN_TOTAL));

    dv.setUint32(0, messageLength, true);
    dv.setUint32(4, messageLength, true);
    dv.setInt16(8, 689, true);
    dv.setInt16(10, 0, true);

    new Uint8Array(dv.buffer).set(body, HEADER_LEN_TOTAL);
    return dv.buffer;
  }

  static decode(buf: ArrayBuffer | ArrayBufferView, callback: PacketDecodeCallback): void {
    const decoder = new TextDecoder();
    const buffer: ArrayBuffer = toArrayBuffer(buf);
    const view = new DataView(buffer);
    let offset = 0;

    while (offset + HEADER_LEN_SIZE <= buffer.byteLength) {
      const readLength = view.getUint32(offset, true);
      offset += HEADER_LEN_SIZE;

      // 畸形帧（长度装不下 8 字节头部余量 + \0 结尾）或截断帧：丢弃剩余部分
      if (readLength < HEADER_LEN_TOTAL - HEADER_LEN_SIZE + 1) return;
      if (offset + readLength > buffer.byteLength) return;

      const bodyStart = offset + (HEADER_LEN_TOTAL - HEADER_LEN_SIZE);
      const bodyLength = readLength - (HEADER_LEN_TOTAL - HEADER_LEN_SIZE) - 1;
      const message = decoder.decode(new Uint8Array(buffer, bodyStart, bodyLength));
      offset += readLength;
      callback(message);
    }
  }

  // Legacy aliases for backwards compatibility
  static Encode = Packet.encode;
  static Decode = Packet.decode;
}
