import type {
  IWebSocket,
  IClient,
  ClientOptions,
  ClientEventName,
  ClientEventHandler,
  MessageEventType,
  STTObject,
  WebSocketFactory,
} from './types';
import { STT } from './core/stt';
import { Packet } from './core/packet';
import { HEARTBEAT_INTERVAL } from './core/config';
import { createDefaultMessageEvents, type MessageHandler, type MessageEventMap } from './events/messageEvent';

export { STT } from './core/stt';
export { Packet } from './core/packet';
export * from './core/danmaku';
export type {
  STTValue,
  STTObject,
  STTArray,
  IWebSocket,
  IClient,
  ClientOptions,
  ClientEventName,
  ClientEventHandler,
  MessageEventType,
  WebSocketFactory,
  ChatMsg,
  LoginRes,
  UEnter,
  RecordMeta,
  RecordedMessage,
  ParsedRecord,
  ConvertWindow,
  FilterScript,
  FilterRules,
  DanmakuItem,
  LayoutConfig,
  PositionedDanmaku,
  AssOptions,
} from './types';

function defaultWsFactory(url: string): IWebSocket {
  // Node.js: always use ws package (Node v21+ has built-in WebSocket via undici
  // but its onmessage event.data is Blob, not Buffer — incompatible with our Packet decoder)
  if (typeof process !== 'undefined' && process.versions?.node) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WS = require('ws');
    return new WS(url) as unknown as IWebSocket;
  }
  // Browser: native WebSocket
  return new WebSocket(url) as unknown as IWebSocket;
}

export const DANMU_PORTS = [8501, 8502, 8503, 8504, 8505, 8506];

function randomPort(): number {
  return DANMU_PORTS[Math.floor(Math.random() * DANMU_PORTS.length)];
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** ws 的 ErrorEvent / DOM ErrorEvent / Error / 其他值统一转 Error（String(event) 会得到无用的 "[object Object]"） */
function toError(event: unknown): Error {
  if (event instanceof Error) return event;
  if (typeof event === 'object' && event !== null) {
    const e = event as { error?: unknown; message?: unknown };
    if (e.error instanceof Error) return e.error;
    if (e.message) return new Error(String(e.message));
  }
  return new Error(String(event));
}

export class Client implements IClient {
  readonly roomId: string | number;

  private _ws: IWebSocket | null = null;
  private _heartbeatTask: ReturnType<typeof setInterval> | null = null;
  private _ignore: Set<MessageEventType>;
  private _wsFactory: WebSocketFactory;
  private _userEvents: Record<ClientEventName, ClientEventHandler[]>;
  private _messageEvents: MessageEventMap;

  constructor(
    roomId: string | number,
    opts: ClientOptions = {},
    wsFactory?: WebSocketFactory,
  ) {
    this.roomId = roomId;
    this._ignore = new Set(opts.ignore ?? []);
    this._wsFactory = wsFactory ?? defaultWsFactory;
    this._userEvents = { connect: [], disconnect: [], error: [] };
    this._messageEvents = createDefaultMessageEvents();
  }

  on(event: ClientEventName, cb: ClientEventHandler): this;
  on(event: MessageEventType, cb: MessageHandler): this;
  on(event: ClientEventName | MessageEventType, cb: ClientEventHandler | MessageHandler): this {
    if (event === 'connect' || event === 'disconnect' || event === 'error') {
      this._userEvents[event].push(cb as ClientEventHandler);
    } else {
      this._messageEvents[event as MessageEventType] = cb as MessageHandler;
    }
    return this;
  }

  run(url?: string): void {
    // 重复 run()：先拆掉旧连接，避免泄漏和旧 socket 事件串扰
    if (this._ws) {
      this._teardown(this._ws);
      this._ws = null;
    }
    if (this._heartbeatTask !== null) {
      clearInterval(this._heartbeatTask);
      this._heartbeatTask = null;
    }

    const port = randomPort();
    const wsUrl = url ?? `wss://danmuproxy.douyu.com:${port}/`;
    const ws = this._wsFactory(wsUrl);
    this._ws = ws;

    // 所有 handler 校验 socket 仍是当前代际，过期事件一律丢弃
    ws.onopen = () => {
      if (this._ws === ws) this._emit('connect');
    };

    ws.onerror = (event) => {
      if (this._ws === ws) {
        this._emit('error', toError(event));
      }
    };

    ws.onclose = () => {
      if (this._ws !== ws) return;
      this._ws = null;
      this._emit('disconnect');
    };

    ws.onmessage = (event) => {
      if (this._ws !== ws) return;
      const data = event.data;
      if (data instanceof Blob) {
        data.arrayBuffer().then((buf) => {
          if (this._ws === ws) this._messageHandle(buf);
        });
      } else {
        this._messageHandle(data as ArrayBuffer);
      }
    };
  }

  send(message: STTObject): void {
    if (!this._ws) throw new Error('Not connected');
    this._ws.send(Packet.encode(STT.serialize(message)));
  }

  close(): void {
    this._logout();
    const ws = this._ws;
    if (!ws) return;
    if (ws.readyState === WS_CONNECTING) {
      // 连接未建立：直接拆除。ws 库在 close-before-established 时会 emit 'error'，
      // 不吞掉会向用户抛出无意义的错误事件
      this._teardown(ws);
      this._ws = null;
      return;
    }
    // 已建立（或关闭中）的连接：不立刻置空，close 帧完成后 onclose 里统一清理并触发 disconnect
    ws.close();
  }

  /** 解绑事件并关闭 socket；onerror 换成空函数而不是 null——
   *  ws 在 close-before-established 时 emit 'error'，无监听器会崩掉进程 */
  private _teardown(ws: IWebSocket): void {
    ws.onopen = ws.onclose = ws.onmessage = null;
    ws.onerror = () => {};
    ws.close();
  }

  private _emit(event: ClientEventName, err?: Error): void {
    if (event === 'connect') {
      this._login();
      this._joinGroup();
      this._heartbeat();
    } else if (event === 'disconnect') {
      this._logout();
    }

    const handlers = this._userEvents[event];
    if (event === 'error' && handlers.length === 0) {
      console.error(err);
      return;
    }
    for (const handler of handlers) {
      handler(this, err);
    }
  }

  private _login(): void {
    this.send({ type: 'loginreq', roomid: String(this.roomId) });
  }

  private _joinGroup(): void {
    this.send({ type: 'joingroup', rid: String(this.roomId), gid: '-9999' });
  }

  private _heartbeat(): void {
    if (this._heartbeatTask !== null) clearInterval(this._heartbeatTask);
    this._heartbeatTask = setInterval(() => {
      // socket 非 OPEN 时跳过（连接切换/关闭的窗口期，send 会抛异常）
      if (this._ws && (this._ws.readyState === undefined || this._ws.readyState === WS_OPEN)) {
        this.send({ type: 'mrkl' });
      }
    }, HEARTBEAT_INTERVAL * 1000);
  }

  private _logout(): void {
    // readyState 缺省（自定义 factory 未实现）视为 OPEN；CONNECTING/CLOSING/CLOSED 时发 send 会抛异常
    if (this._ws && (this._ws.readyState === undefined || this._ws.readyState === WS_OPEN)) {
      this.send({ type: 'logout' });
    }
    if (this._heartbeatTask !== null) {
      clearInterval(this._heartbeatTask);
      this._heartbeatTask = null;
    }
  }

  private _messageHandle(data: unknown): void {
    const buf = data as ArrayBuffer;

    Packet.decode(buf, (raw) => {
      const r = STT.deserialize(raw) as STTObject;

      const type = String(r.type) as MessageEventType;
      if (!this._ignore.has(type)) {
        const handler = this._messageEvents[type];
        if (handler) handler(r, this);
      }
    });
  }
}

export default Client;
