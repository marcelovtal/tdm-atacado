import IORedis from 'ioredis';
import { config } from './config.js';

/**
 * Opções de conexão BullMQ/ioredis.
 * Em QA usa Redis Sentinel (alta disponibilidade); em local, conexão direta.
 */
export function getRedisConnectionOptions() {
  const { redis } = config;

  if (redis.mode === 'sentinel') {
    return {
      sentinels: redis.sentinels,
      name: redis.masterName,
      password: redis.password,
      sentinelPassword: redis.sentinelPassword || redis.password,
      maxRetriesPerRequest: redis.maxRetriesPerRequest,
    };
  }

  return {
    host: redis.host,
    port: redis.port,
    password: redis.password,
    maxRetriesPerRequest: redis.maxRetriesPerRequest,
  };
}

export function createRedisClient(extra = {}) {
  return new IORedis({
    ...getRedisConnectionOptions(),
    ...extra,
  });
}
