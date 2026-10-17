/**
 * Provider window injection
 * Handles injecting the provider into the window object
 */

export function defineUnwritablePropertyIfPossible(o: any, p: string, value: any): void {
  const descriptor = Object.getOwnPropertyDescriptor(o, p);
  if (!descriptor || descriptor.writable) {
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(o, p, {
        value,
        writable: false
      });
    } else {
      o[p] = value;
    }
  } else {
    console.warn(`Failed to inject ${p} from unisat. Probably, other wallet is trying to intercept UniSat Wallet`);
  }
}

export function createProviderProxy(provider: any, requestMethodKey: symbol): any {
  const isPrivateProperty = (prop: string | symbol) =>
    prop === requestMethodKey || (typeof prop === 'string' && (prop.startsWith('_') || prop === 'bitcoinAPI'));

  return new Proxy(provider, {
    deleteProperty: () => true,
    get: (target, prop) => {
      if (prop === '_events' || prop === '_eventsCount' || prop === '_maxListeners') {
        return target[prop];
      }

      // Block access to methods starting with underscore or Symbol methods
      if (isPrivateProperty(prop)) {
        console.warn(
          `[UniSat] Attempted access to private method: ${String(prop)} is not allowed for security reasons`
        );
        return undefined;
      }
      return target[prop];
    },
    getOwnPropertyDescriptor: (target, prop) =>
      isPrivateProperty(prop) ? undefined : Reflect.getOwnPropertyDescriptor(target, prop),
    has: (target, prop) => !isPrivateProperty(prop) && Reflect.has(target, prop),
    ownKeys: (target) => Reflect.ownKeys(target).filter((prop) => !isPrivateProperty(prop)),
    // A non-extensible target requires ownKeys to expose every own property.
    // Keep the target extensible so private properties can remain hidden.
    preventExtensions: () => false
  });
}

export function injectProviderToWindow(provider: any): void {
  defineUnwritablePropertyIfPossible(window, 'unisat', provider);

  // Many wallets occupy the window.unisat namespace, so we need to use a different namespace to avoid conflicts.
  defineUnwritablePropertyIfPossible(window, 'unisat_wallet', provider);

  window.dispatchEvent(new Event('unisat#initialized'));
}
