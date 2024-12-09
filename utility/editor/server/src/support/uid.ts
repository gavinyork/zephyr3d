let uniqueId = 1;

/**
 * algorithm from Twitter
 * 1bit(unused) + 41bit(timestamp) + 10bit(serverId) + 12bit(uniqueId)
 */
export function createUID(prefix?: string, serverId?: number): string {
  if (serverId === undefined) {
    serverId = 1;
  }
  const tm = BigInt(Date.now());
  const sid = BigInt(serverId % 0x400);
  const uid = BigInt(uniqueId++ % 0x1000);
  let value = String((tm << 22n) + (sid << 12n) + uid);
  while (value.length < 20) {
    value = `0${value}`;
  }
  if (prefix) {
    value = prefix + value;
  }
  return value;
}
