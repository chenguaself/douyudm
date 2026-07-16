// 逐条判定示例：true 保留，false 剔除。
// 剔除纯数字/纯标点的刷屏弹幕，以及超过 50 字的复读长文。
export default (msg) => {
  const txt = msg.txt ?? '';
  if (/^[\d\s!！?？.。~～]+$/.test(txt)) return false;
  if (txt.length > 50) return false;
  return true;
};
