const Redis = require('ioredis');

let redisClient;
let isUsingMock = false;

const mockRedis = {
  store: new Map(),
  
  get: async (key) => {
    return mockRedis.store.get(key) || null;
  },
  
  set: async (key, value) => {
    mockRedis.store.set(key, String(value));
    return 'OK';
  },
  
  del: async (key) => {
    return mockRedis.store.delete(key) ? 1 : 0;
  },
  
  incr: async (key) => {
    const val = parseInt(mockRedis.store.get(key) || '0', 10) + 1;
    mockRedis.store.set(key, String(val));
    return val;
  },
  
  decr: async (key) => {
    const val = parseInt(mockRedis.store.get(key) || '0', 10) - 1;
    mockRedis.store.set(key, String(val));
    return val;
  },
  
  sadd: async (key, member) => {
    if (!mockRedis.store.has(key)) {
      mockRedis.store.set(key, new Set());
    }
    const set = mockRedis.store.get(key);
    const sizeBefore = set.size;
    set.add(String(member));
    return set.size > sizeBefore ? 1 : 0;
  },
  
  srem: async (key, member) => {
    if (!mockRedis.store.has(key)) return 0;
    const set = mockRedis.store.get(key);
    return set.delete(String(member)) ? 1 : 0;
  },
  
  smembers: async (key) => {
    if (!mockRedis.store.has(key)) return [];
    return Array.from(mockRedis.store.get(key));
  },
  
  scard: async (key) => {
    if (!mockRedis.store.has(key)) return 0;
    return mockRedis.store.get(key).size;
  }
};

function connectRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  return new Promise((resolve) => {
    console.log('Connecting to Redis at:', redisUrl);
    
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true
    });
    
    client.on('error', () => {});
    
    client.connect()
      .then(() => {
        console.log('Redis connected successfully.');
        redisClient = client;
        isUsingMock = false;
        resolve(redisClient);
      })
      .catch((error) => {
        console.warn('\n⚠️  Redis Connection Failed:', error.message);
        console.warn('⚠️  Falling back to IN-MEMORY REDIS MOCK.\n');
        redisClient = mockRedis;
        isUsingMock = true;
        resolve(redisClient);
      });
  });
}

module.exports = {
  connectRedis,
  getRedisClient: () => redisClient,
  isMock: () => isUsingMock
};
