const RUNE_ID = /^\d+:\d+$/;
const RUNE_NAME = /^[A-Z]+(?:[•.][A-Z]+)*$/;
const names = new Map<string, Promise<string>>();

export function historyRuneId(asset: { assetId?: string; displayName?: string; symbol: string }) {
  return [asset.assetId, asset.displayName, asset.symbol].find(value => value && RUNE_ID.test(value)) || '';
}

export function historyRuneName(asset: { displayName?: string; symbol: string }) {
  return [asset.displayName, asset.symbol].find(value => value && RUNE_NAME.test(value)) || '';
}

/** Cache immutable rune metadata, including in-flight queries, separately for each chain. */
export function resolveHistoryRuneName(network: string, id: string, load: () => Promise<string>) {
  const key = `${network}:${id}`;
  const cached = names.get(key);
  if (cached) return cached;
  if (names.size >= 256) names.delete(names.keys().next().value!);
  let timer: ReturnType<typeof setTimeout>;
  const pending = Promise.race([
    Promise.resolve().then(load),
    new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Rune metadata lookup timed out')), 10000);
    })
  ]).then(name => {
    if (!RUNE_NAME.test(name)) throw new Error('Rune metadata has no valid spacedRune');
    return name;
  }).catch(error => {
    if (names.get(key) === pending) names.delete(key);
    throw error;
  }).finally(() => clearTimeout(timer));
  names.set(key, pending);
  return pending;
}
