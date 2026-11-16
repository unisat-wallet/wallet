const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function validateHostname(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized || normalized.length > 253) return null
  const labels = normalized.split('.')
  if (labels.some(label => !HOSTNAME_LABEL.test(label))) return null
  return normalized
}

export function normalizePhishingHostname(hostname: unknown): string | null {
  if (typeof hostname !== 'string') return null
  const normalized = validateHostname(hostname)
  return normalized?.replace(/^www\./, '') ?? null
}

export type PhishingTarget = { href: string; hostname: string }

export function parsePhishingTargetUrl(value: unknown): PhishingTarget | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const hostname = validateHostname(url.hostname)
    if (!hostname) return null
    url.hostname = hostname
    return { href: url.toString(), hostname }
  } catch {
    return null
  }
}
