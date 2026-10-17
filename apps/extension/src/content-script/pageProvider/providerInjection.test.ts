import { createProviderProxy } from './providerInjection';

describe('createProviderProxy', () => {
  it('keeps private properties hidden after attempts to lock the provider', () => {
    const requestMethodKey = Symbol('requestMethod');
    const provider = {
      publicMethod: () => 'ok',
      bitcoinAPI: {},
      _privateMethod: () => 'private',
      [requestMethodKey]: () => 'request'
    };
    const exposed = createProviderProxy(provider, requestMethodKey);

    expect(Reflect.preventExtensions(exposed)).toBe(false);
    expect(() => Object.preventExtensions(exposed)).toThrow(TypeError);
    expect(() => Object.seal(exposed)).toThrow(TypeError);
    expect(() => Object.freeze(exposed)).toThrow(TypeError);
    expect(Object.isExtensible(provider)).toBe(true);
    expect(Object.keys(exposed)).toEqual(['publicMethod']);
    expect(Reflect.ownKeys(exposed)).toEqual(['publicMethod']);
    expect(Object.getOwnPropertyDescriptor(exposed, 'bitcoinAPI')).toBeUndefined();
    expect(exposed.publicMethod()).toBe('ok');
  });
});
