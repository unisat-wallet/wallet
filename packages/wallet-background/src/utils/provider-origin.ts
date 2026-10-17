type ProviderMessageSender = {
  url?: string
}

/**
 * Return the origin of the document that opened a provider connection.
 *
 * `sender.tab.url` is the tab's current URL and can change while the original
 * document is still being unloaded. `sender.url` is bound to the sending
 * document, so it remains stable for the lifetime of the port.
 */
export function getTrustedProviderOrigin(sender?: ProviderMessageSender): string {
  if (!sender?.url) {
    throw new Error('Cannot verify request origin')
  }

  let url: URL
  try {
    url = new URL(sender.url)
  } catch {
    throw new Error('Cannot verify request origin')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Unsupported request origin')
  }

  return url.origin
}
