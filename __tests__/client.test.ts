/**
 * Client 生命周期回归测试(2026-07 审查修复 1/2/5),使用 mock WebSocketFactory,无真实网络。
 */
import { Client, Packet, STT } from '../src/index';
import type { IWebSocket, STTObject } from '../src/types';

class MockWS implements IWebSocket {
  readyState = 0; // CONNECTING
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer | Buffer }) => void) | null = null;

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== 1) throw new Error(`send on readyState ${this.readyState}`);
    this.sent.push(data as ArrayBuffer);
  }

  close(): void {
    this.closed = true;
    const was = this.readyState;
    this.readyState = 3;
    if (was !== 3 && this.onclose) this.onclose({});
  }

  // 测试辅助:模拟服务端完成握手
  open(): void {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }

  sentTypes(): string[] {
    const types: string[] = [];
    for (const buf of this.sent) {
      Packet.decode(buf, (raw) => types.push(String((STT.deserialize(raw) as STTObject).type)));
    }
    return types;
  }
}

function makeClient(): { client: Client; sockets: MockWS[] } {
  const sockets: MockWS[] = [];
  const client = new Client(9999, {}, () => {
    const ws = new MockWS();
    sockets.push(ws);
    return ws;
  });
  return { client, sockets };
}

describe('Client 生命周期', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('close() 在 CONNECTING 阶段不抛异常', () => {
    const { client, sockets } = makeClient();
    client.run();
    expect(sockets[0].readyState).toBe(0);
    expect(() => client.close()).not.toThrow();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].sent).toHaveLength(0); // 未发出任何帧(含 logout)
  });

  test('close() 在 OPEN 阶段发送 logout 并触发 disconnect', () => {
    const { client, sockets } = makeClient();
    const disconnected = jest.fn();
    client.on('disconnect', disconnected);
    client.run();
    sockets[0].open();
    client.close();
    expect(sockets[0].sentTypes()).toEqual(['loginreq', 'joingroup', 'logout']);
    expect(sockets[0].closed).toBe(true);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  test('重复 run() 关闭旧连接,旧 socket 不再串扰新连接', () => {
    const { client, sockets } = makeClient();
    client.run();
    sockets[0].open();
    client.run();
    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    // 旧 socket 关闭事件不应向新连接发送 logout
    expect(sockets[1].sentTypes()).toEqual(['loginreq', 'joingroup']);
    client.close(); // 清理心跳 interval,否则 jest 不退出
  });

  test('重复 run() 心跳不叠加', () => {
    jest.useFakeTimers();
    const { client, sockets } = makeClient();
    client.run();
    sockets[0].open();
    client.run();
    sockets[1].open();

    jest.advanceTimersByTime(45_000);
    const mrkl = sockets[1].sentTypes().filter((t) => t === 'mrkl');
    expect(mrkl).toHaveLength(1); // 叠加则为 2
    client.close();
  });

  test('重复 run() 后新连接握手完成前,旧心跳不向 CONNECTING socket 发包', () => {
    jest.useFakeTimers();
    const { client, sockets } = makeClient();
    client.run();
    sockets[0].open(); // 心跳启动
    client.run(); // 新 socket 尚未 open
    expect(() => jest.advanceTimersByTime(90_000)).not.toThrow();
    expect(sockets[1].sent).toHaveLength(0);
    client.close();
  });

  test('服务端断开后心跳停止,不再向已关闭 socket 发送', () => {
    jest.useFakeTimers();
    const { client, sockets } = makeClient();
    client.run();
    sockets[0].open();
    sockets[0].close(); // 模拟服务端断开 → onclose
    const before = sockets[0].sent.length;
    expect(() => jest.advanceTimersByTime(90_000)).not.toThrow();
    expect(sockets[0].sent.length).toBe(before);
  });

  test('多个 error handler 全部触发(不再只有最后一个生效)', () => {
    const { client, sockets } = makeClient();
    const h1 = jest.fn();
    const h2 = jest.fn();
    client.on('error', h1).on('error', h2);
    client.run();
    sockets[0].onerror?.(new Error('boom'));
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h1.mock.calls[0][1]?.message).toBe('boom');
  });

  test('多个 connect handler 全部触发且内建登录流程照常', () => {
    const { client, sockets } = makeClient();
    const h1 = jest.fn();
    const h2 = jest.fn();
    client.on('connect', h1).on('connect', h2);
    client.run();
    sockets[0].open();
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(sockets[0].sentTypes()).toEqual(['loginreq', 'joingroup']);
    client.close();
  });

  test('无 error handler 时回退 console.error 且不抛出', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { client, sockets } = makeClient();
    client.run();
    expect(() => sockets[0].onerror?.(new Error('boom'))).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test('消息分发:收到 chatmsg 触发注册的 handler', () => {
    const { client, sockets } = makeClient();
    const onChat = jest.fn();
    client.on('chatmsg', onChat);
    client.run();
    sockets[0].open();
    sockets[0].onmessage?.({
      data: Packet.encode(STT.serialize({ type: 'chatmsg', nn: 'tester', txt: 'hi' })),
    });
    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onChat.mock.calls[0][0]).toMatchObject({ type: 'chatmsg', nn: 'tester', txt: 'hi' });
    client.close();
  });
});
