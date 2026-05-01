/**
 * @file src/server-helpers/ndjson.js
 * @description NDJSON 流响应基础工具。只负责 Express response 头和单包写入，不包含聊天业务语义。
 */

function writeNdjson(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
  if (typeof res.flush === 'function') {
    res.flush();
  }
}

function initNdjsonStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

module.exports = {
  writeNdjson,
  initNdjsonStream,
};
