import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhishingAdapter, PhishingConfig } from '../src/types'
import { PhishingService } from '../src/phishing-service'
import { normalizePhishingHostname, parsePhishingTargetUrl } from '../src/hostname'
import { fetchHotlist, fetchPhishingList } from 'utils/fetch'

vi.mock('utils/fetch', () => ({
  fetchPhishingList: vi.fn(),
  fetchHotlist: vi.fn(),
}))

const mockedFetchPhishingList = vi.mocked(fetchPhishingList)
const mockedFetchHotlist = vi.mocked(fetchHotlist)

const createRemoteConfig = (overrides?: Partial<PhishingConfig>): PhishingConfig => ({
  version: 2,
  tolerance: 1,
  fuzzylist: [],
  whitelist: [],
  blacklist: ['evil.com'],
  lastFetchTime: 0,
  cacheExpireTime: 24 * 60 * 60 * 1000,
  ...overrides,
})

const createAdapter = (stored?: unknown): PhishingAdapter & { get: any; set: any } => ({
  get: vi.fn().mockResolvedValue(stored),
  set: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn(),
})

describe('PhishingService', () => {
  const services: PhishingService[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetchHotlist.mockResolvedValue(null)
    mockedFetchPhishingList.mockResolvedValue(createRemoteConfig())
  })

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.destroy()
    }
  })

  it('loads remote config when local config is missing and detects blacklisted hostname', async () => {
    const adapter = createAdapter(undefined)
    const service = new PhishingService()
    services.push(service)

    const detected = vi.fn()
    service.on('phishing:detected', detected)

    await service.init({ adapter })

    expect(mockedFetchPhishingList).toHaveBeenCalledTimes(1)
    expect(mockedFetchHotlist).toHaveBeenCalledTimes(1)

    const result = service.checkPhishing('www.EVIL.com')
    expect(result).toEqual({
      isPhishing: true,
      reason: 'Blacklist match',
      matchedPattern: 'evil.com',
    })
    expect(detected).toHaveBeenCalledWith('www.EVIL.com', 'Blacklist match')
    expect(service.isPhishing('evil.com')).toBe(true)
  })

  it('temporary whitelist takes precedence over blacklist', async () => {
    const adapter = createAdapter(createRemoteConfig({ blacklist: ['evil.com'] }))
    const service = new PhishingService()
    services.push(service)

    await service.init({ adapter })

    service.addToWhitelist('WWW.EVIL.com')
    const result = service.checkPhishing('evil.com')

    expect(result).toEqual({ isPhishing: false, reason: 'Temporary whitelist' })
  })

  it('can add and remove permanent whitelist entries with persistence', async () => {
    const adapter = createAdapter(
      createRemoteConfig({
        whitelist: [],
        blacklist: ['trap.com'],
      })
    )
    const service = new PhishingService()
    services.push(service)

    await service.init({ adapter })
    expect(adapter.set).not.toHaveBeenCalled()

    await service.addToPermanentWhitelist('www.trap.com')
    expect(adapter.set).toHaveBeenCalledTimes(1)
    expect(service.checkPhishing('trap.com')).toEqual({
      isPhishing: false,
      reason: 'Permanent whitelist',
    })

    await service.addToPermanentWhitelist('trap.com')
    expect(adapter.set).toHaveBeenCalledTimes(1)

    await service.removeFromWhitelist('trap.com')
    expect(adapter.set).toHaveBeenCalledTimes(2)
    expect(service.checkPhishing('trap.com').isPhishing).toBe(true)
  })

  it('emits error and still updates from remote when loading local config fails', async () => {
    const loadError = new Error('storage read failed')
    const adapter = createAdapter()
    adapter.get.mockRejectedValue(loadError)
    mockedFetchPhishingList.mockResolvedValue(createRemoteConfig({ blacklist: ['recovered.com'] }))

    const logger = { error: vi.fn() }
    const service = new PhishingService()
    services.push(service)
    const onError = vi.fn()
    service.on('phishing:error', onError)

    await service.init({ adapter, logger })

    expect(onError).toHaveBeenCalledWith(loadError)
    expect(logger.error).toHaveBeenCalled()
    expect(service.checkPhishing('recovered.com').isPhishing).toBe(true)
  })

  it('applies hotlist allowlist and blacklist after initialization', async () => {
    const adapter = createAdapter(
      createRemoteConfig({
        whitelist: [],
        blacklist: ['base.com'],
      })
    )
    mockedFetchHotlist.mockResolvedValue({
      allowlist: ['safe-hot.com'],
      blacklist: ['evil-hot.com'],
    })

    const service = new PhishingService()
    services.push(service)
    await service.init({ adapter })

    await (service as any).fetchAndApplyHotlist()
    expect(mockedFetchHotlist).toHaveBeenCalled()

    expect(service.checkPhishing('safe-hot.com')).toEqual({
      isPhishing: false,
      reason: 'Temporary whitelist',
    })
    expect(service.checkPhishing('evil-hot.com').isPhishing).toBe(true)
  })

  it('normalizes valid hostnames, rejects filter syntax, and matches subdomains consistently', async () => {
    const adapter = createAdapter(
      createRemoteConfig({
        blacklist: ['WWW.EVIL.com', 'sub.bad.example', '*.injected.example', 'bad.example/path'],
      })
    )
    const service = new PhishingService()
    services.push(service)

    await service.init({ adapter })

    expect(service.getConfig().blacklist).toEqual(['evil.com', 'sub.bad.example'])
    expect(service.checkPhishing('login.evil.com')).toMatchObject({
      isPhishing: true,
      matchedPattern: 'evil.com',
    })
    expect(service.getBlockedHostnames()).toEqual(['evil.com', 'sub.bad.example'])

    service.addToWhitelist('evil.com')
    expect(service.getBlockedHostnames()).toEqual(['sub.bad.example'])
  })

  it('keeps the last known-good blacklist when an update has no valid domains', async () => {
    const adapter = createAdapter(createRemoteConfig({ blacklist: ['known-bad.example'] }))
    const service = new PhishingService()
    services.push(service)
    await service.init({ adapter })
    mockedFetchPhishingList.mockResolvedValue(
      createRemoteConfig({ blacklist: ['*', 'https://invalid.example/path'] })
    )

    await service.forceUpdate()

    expect(service.checkPhishing('known-bad.example').isPhishing).toBe(true)
    expect(service.getConfig().blacklist).toEqual(['known-bad.example'])
  })
})

describe('phishing target validation', () => {
  it('accepts only credential-free HTTP(S) URLs with safe hostnames', () => {
    expect(parsePhishingTargetUrl('https://Example.com/path?q=1')).toEqual({
      href: 'https://example.com/path?q=1',
      hostname: 'example.com',
    })
    expect(parsePhishingTargetUrl('javascript:alert(1)')).toBeNull()
    expect(parsePhishingTargetUrl('https://trusted.example@evil.example/')).toBeNull()
    expect(parsePhishingTargetUrl('https://evil.example|redirect/')).toBeNull()
  })

  it('normalizes hostnames without accepting DNR filter characters', () => {
    expect(normalizePhishingHostname('WWW.Example.com.')).toBe('example.com')
    expect(normalizePhishingHostname('*.example.com')).toBeNull()
    expect(normalizePhishingHostname('example.com/path')).toBeNull()
  })
})
