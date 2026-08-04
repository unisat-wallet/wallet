import { PlatformEnv } from '@unisat/wallet-shared';

/** Webpack DefinePlugin injects these; fall back so a bad local build cannot crash connect/UI. */
const release = typeof process.env.release === 'string' && process.env.release ? process.env.release : '1.7.17';
const channel = typeof process.env.channel === 'string' && process.env.channel ? process.env.channel : 'github';
const manifest = typeof process.env.manifest === 'string' && process.env.manifest ? process.env.manifest : 'mv3';

PlatformEnv.VERSION = release;
PlatformEnv.CHANNEL = channel;
PlatformEnv.PLATFORM = 'extension';
PlatformEnv.MANIFEST_VERSION = manifest;
PlatformEnv.REVIEW_URL =
  'https://chromewebstore.google.com/detail/unisat-wallet/ppbibelpcjmhbdihakflkdcoccbgbkpo/reviews';

export const initPlatformEnv = async () => {
  //   await deviceService.preloadDeviceUUID();
  //   PlatformEnv.UDID2 = deviceService.getDeviceUUID();
};
