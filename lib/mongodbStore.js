'use strict';

function buildMongoUri(payload) {
  const host = String(payload && payload.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(payload && payload.port) > 0 ? Math.trunc(Number(payload.port)) : 27017;
  const username = String(payload && payload.username || '');
  const password = String(payload && payload.password || '');
  const database = String(payload && payload.database || '').trim();
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  return `mongodb://${auth}${host}:${port}${database ? `/${encodeURIComponent(database)}` : ''}`;
}

function formatProbeError(error) {
  if (!error) return 'MongoDB 连接失败';
  if (error.code === 18 || error.codeName === 'AuthenticationFailed') return '账号或密码错误';
  if (error.name === 'MongoServerSelectionError' || error.code === 'ECONNREFUSED') return '连接被拒绝（主机或端口不可达）';
  if (error.name === 'MongoParseError') return 'MongoDB 连接配置无效';
  return error.message || 'MongoDB 连接失败';
}

async function probe(payload, timeoutMs) {
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (error) {
    return { ok: false, mode: 'mongodb', error: '未安装 mongodb，无法测试 MongoDB 连接' };
  }
  const timeout = Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 8000;
  const database = String(payload && payload.database || '').trim();
  const client = new MongoClient(buildMongoUri(payload), {
    connectTimeoutMS: timeout,
    serverSelectionTimeoutMS: timeout
  });
  try {
    await client.connect();
    await client.db(database || 'admin').command({ ping: 1 });
    return {
      ok: true,
      mode: 'mongodb',
      host: String(payload && payload.host || '127.0.0.1'),
      port: Number(payload && payload.port) > 0 ? Math.trunc(Number(payload.port)) : 27017,
      database
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'mongodb',
      host: String(payload && payload.host || '127.0.0.1'),
      port: Number(payload && payload.port) > 0 ? Math.trunc(Number(payload.port)) : 27017,
      error: formatProbeError(error)
    };
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { buildMongoUri, formatProbeError, probe };
