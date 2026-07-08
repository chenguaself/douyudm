/**
 * 真实网络测试：验证 DANMU_PORTS 中每个端口的弹幕服务可用
 * （WSS 握手 → loginreq → 收到 loginres）。
 *
 * 默认 `pnpm test` 不跑（jest.config.js 排除 *.live.test.ts），
 * 单独执行：`pnpm run test:ports`
 */
import WebSocket from 'ws';
import { DANMU_PORTS } from '../src/index';
import { Packet } from '../src/core/packet';
import { STT } from '../src/core/stt';

const CONNECT_TIMEOUT = 10_000;

function firstResponseType(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://danmuproxy.douyu.com:${port}/`);
    const fail = (err: Error) => {
      clearTimeout(timer);
      ws.terminate();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`port ${port}: no response in ${CONNECT_TIMEOUT}ms`)), CONNECT_TIMEOUT);

    ws.on('open', () => {
      ws.send(Packet.encode(STT.serialize({ type: 'loginreq', roomid: '9999' })));
    });
    ws.on('message', (data: WebSocket.RawData) => {
      clearTimeout(timer);
      let type = '';
      Packet.decode(data as Buffer, (message) => {
        if (!type) type = String((STT.deserialize(message) as { type?: string })?.type ?? '');
      });
      ws.terminate();
      resolve(type);
    });
    ws.on('error', fail);
  });
}

describe('danmuproxy.douyu.com 弹幕端口可用性', () => {
  test.each(DANMU_PORTS)(
    'wss://danmuproxy.douyu.com:%i/ 响应 loginres',
    async (port) => {
      await expect(firstResponseType(port)).resolves.toBe('loginres');
    },
    CONNECT_TIMEOUT + 5_000,
  );
});
