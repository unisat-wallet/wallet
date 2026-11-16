import log from 'loglevel'

import { normalizePhishingHostname, parsePhishingTargetUrl } from '@unisat/phishing-detect'
import { PhishingMessageType, PlatformEnv } from '@unisat/wallet-shared'
import { phishingDetectService as phishingService } from 'src/services'

/**
 * Default update interval for phishing rules (24 hours)
 */
const DEFAULT_UPDATE_INTERVAL = 24 * 60 * 60 * 1000

/**
 * PhishingController class for handling all phishing protection related functionality
 */
class PhishingController {
  private updateIntervalId: ReturnType<typeof setInterval> | null = null

  /**
   * Initialize phishing protection features
   */
  public init(): void {
    // Register message listener for phishing-related messages
    this.registerMessageListener()

    // Setup declarative rules for MV3
    this.setupDeclarativeRules()
  }

  /**
   * Register message listener for phishing-related messages
   */
  private registerMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle phishing-related messages
      if (Object.values(PhishingMessageType).includes(message.type)) {
        return this.handleMessage(message, sender, sendResponse)
      }

      return false
    })
  }

  /**
   * Handle phishing-related messages
   * @param message Message object
   * @param sender Sender information
   * @param sendResponse Response callback
   * @returns True if handled asynchronously
   */
  private handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): boolean {
    try {
      switch (message.type) {
        case PhishingMessageType.CHECK_PHISHING: {
          if (!message.hostname) {
            sendResponse({ error: 'Missing hostname parameter' })
            return false
          }

          const isPhishing = phishingService.checkPhishing(message.hostname).isPhishing
          sendResponse({ isPhishing })
          return false
        }

        case PhishingMessageType.REDIRECT_TO_PHISHING_PAGE: {
          if (!sender.tab?.id || sender.frameId !== 0) {
            sendResponse({ error: 'Invalid parameters or sender' })
            return false
          }

          const senderTarget = parsePhishingTargetUrl(sender.url)
          const requestedTarget = parsePhishingTargetUrl(message.url)
          const requestedHostname = normalizePhishingHostname(message.hostname)
          if (
            !senderTarget ||
            !requestedTarget ||
            requestedTarget.href !== senderTarget.href ||
            !requestedHostname ||
            requestedHostname !== normalizePhishingHostname(senderTarget.hostname)
          ) {
            sendResponse({ error: 'Navigation target does not match the top-level sender' })
            return false
          }

          // Verify the domain is still in the blacklist before redirecting
          const isPhishing = phishingService.checkPhishing(senderTarget.hostname).isPhishing
          if (!isPhishing) {
            sendResponse({ success: false, skipped: true })
            return false
          }

          this.redirectToPhishingPage(sender.tab.id, senderTarget.href, senderTarget.hostname)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ error: String(error) }))
          return true
        }

        case PhishingMessageType.SKIP_PHISHING_PROTECTION: {
          if (sender.frameId !== 0) {
            sendResponse({ error: 'Only the top-level warning page may continue' })
            return false
          }

          const target = this.getWarningPageTarget(sender.url)
          if (!target || message.href !== target.href) {
            sendResponse({ error: 'Invalid warning target' })
            return false
          }
          if (!phishingService.checkPhishing(target.hostname).isPhishing) {
            sendResponse({ error: 'The warning target is not currently blocked' })
            return false
          }

          phishingService.addToWhitelist(target.hostname)
          this.updateDeclarativeRules({ allowEmpty: true })
            .then(() => sendResponse({ success: true, ...target }))
            .catch(error => {
              phishingService.removeFromTemporaryWhitelist(target.hostname)
              sendResponse({ error: String(error) })
            })
          return true
        }

        case PhishingMessageType.FORCE_UPDATE_PHISHING_LIST: {
          phishingService
            .forceUpdate()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ error: String(error) }))
          return true
        }

        case PhishingMessageType.GET_PHISHING_STATS: {
          sendResponse({ stats: phishingService.getConfig() })
          return false
        }

        case PhishingMessageType.CHECK_NAVIGATION: {
          if (!message.url) {
            sendResponse({ error: 'Missing URL parameter' })
            return false
          }

          try {
            const url = new URL(message.url)

            // Skip checks for phishing warning page URL
            if (
              message.url.includes(chrome.runtime.getURL('phishing.html#/phishing')) ||
              message.url.includes(chrome.runtime.getURL('index.html#/phishing'))
            ) {
              sendResponse({ isPhishing: false, skipped: true })
              return false
            }

            const isPhishing = phishingService.checkPhishing(url.hostname).isPhishing

            if (isPhishing && sender.tab?.id && sender.frameId === 0) {
              this.redirectToPhishingPage(sender.tab.id, message.url, url.hostname)
                .then(() => sendResponse({ isPhishing, redirected: true }))
                .catch(error =>
                  sendResponse({ isPhishing, redirected: false, error: String(error) })
                )
              return true
            }

            sendResponse({ isPhishing, redirected: false })
          } catch (error) {
            sendResponse({ isPhishing: false, error: String(error) })
          }
          return false
        }
      }
    } catch (error) {
      sendResponse({ error: 'Internal error processing request' })
    }

    return false
  }

  /**
   * Redirect a tab to the phishing warning page
   * @param tabId Tab ID to redirect
   * @param url Original URL that was blocked
   * @param hostname Hostname that triggered the phishing detection
   */
  public async redirectToPhishingPage(tabId: number, url: string, hostname: string): Promise<void> {
    try {
      const target = parsePhishingTargetUrl(url)
      if (
        !target ||
        normalizePhishingHostname(target.hostname) !== normalizePhishingHostname(hostname)
      ) {
        throw new Error('Invalid phishing redirect target')
      }

      // Check if current URL is already the warning page to avoid repeated redirects
      const tab = await chrome.tabs.get(tabId)
      const currentUrl = tab.url || ''

      // If already on warning page, don't redirect again
      if (
        currentUrl.includes('phishing.html#/phishing') ||
        currentUrl.includes('index.html#/phishing')
      ) {
        return
      }

      const params = new URLSearchParams({
        href: target.href,
        timestamp: Date.now().toString(), // Add timestamp to prevent caching
      })

      const redirectUrl = chrome.runtime.getURL(`phishing.html#/phishing?${params}`)
      await chrome.tabs.update(tabId, { url: redirectUrl, active: true })
    } catch (error) {
      log.error('[Phishing] Failed to redirect tab:', error)
      throw error // Re-throw to allow proper error handling by caller
    }
  }

  /**
   * Setup phishing protection using declarative rules
   * Initializes rules and schedules periodic updates
   * @param updateInterval Interval in milliseconds for rule updates
   */
  public setupDeclarativeRules(updateInterval = DEFAULT_UPDATE_INTERVAL): void {
    if (PlatformEnv.MANIFEST_VERSION !== 'mv3' || !chrome.declarativeNetRequest) {
      return
    }

    // Initialize declarative rules when extension loads
    this.initDeclarativeRules()

    // Schedule periodic updates of the rules
    this.updateIntervalId = setInterval(() => {
      void this.updateDeclarativeRules().catch(error => {
        log.error('[Phishing] Scheduled declarative rule update failed:', error)
      })
    }, updateInterval)
  }

  /**
   * Initialize declarative network request rules for phishing protection
   * Creates initial rule set based on current phishing list
   */
  public async initDeclarativeRules(): Promise<void> {
    try {
      await this.updateDeclarativeRules()
    } catch (error) {
      log.error('[Phishing] Failed to initialize declarative rules:', error)
    }
  }

  /**
   * Update declarative network request rules based on phishing list
   * Only applicable for MV3 extensions
   */
  public async updateDeclarativeRules(options: { allowEmpty?: boolean } = {}): Promise<void> {
    if (PlatformEnv.MANIFEST_VERSION !== 'mv3' || !chrome.declarativeNetRequest) {
      log.warn('[Phishing] Declarative rules are only available in MV3')
      return
    }

    try {
      const blacklist = phishingService.getBlockedHostnames()

      if (!blacklist.length) {
        log.warn('[Phishing] No blacklisted domains available for rules')
        if (!options.allowEmpty) return
      }

      // Create new rules based on blacklist
      const rules = this.createPhishingRules(blacklist)
      if (!rules.length && !options.allowEmpty) {
        throw new Error('No valid phishing rules were generated; keeping the existing rules')
      }

      // Replace the rules atomically. If validation or installation fails, Chrome keeps the old set.
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: await this.getCurrentRuleIds(),
        addRules: rules,
      })

      log.debug(
        `[Phishing] Updated MV3 declarative rules: ${rules.length} rules created from ${blacklist.length} domains`
      )
    } catch (error) {
      log.error('[Phishing] Failed to update declarative rules:', error)
      throw error
    }
  }

  /**
   * Get current rule IDs for removal
   * @returns Array of rule IDs
   */
  private async getCurrentRuleIds(): Promise<number[]> {
    const rules = await chrome.declarativeNetRequest.getDynamicRules()
    return rules.map(rule => rule.id)
  }

  /**
   * Create declarative network request rules from blacklisted domains
   * @param blacklist Array of blacklisted domains
   * @returns Array of declarative network request rules
   */
  private createPhishingRules(blacklist: string[]): chrome.declarativeNetRequest.Rule[] {
    // Limit number of rules to avoid hitting Chrome's limits
    // Chrome has a limit of 5,000 dynamic rules
    const MAX_RULES = 4900
    const domains = Array.from(
      new Set(
        blacklist.map(normalizePhishingHostname).filter((domain): domain is string => !!domain)
      )
    ).slice(0, MAX_RULES)

    return domains.map((domain, index) => {
      // Rule IDs should be between 1 and 2^32-1
      const ruleId = index + 1

      return {
        id: ruleId,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: {
            url: chrome.runtime.getURL(
              `phishing.html#/phishing?href=${encodeURIComponent(`https://${domain}/`)}&timestamp=${Date.now()}`
            ),
          },
        },
        condition: {
          urlFilter: `||${domain}/`,
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        },
      } as chrome.declarativeNetRequest.Rule
    })
  }

  /**
   * Force update of phishing list and rules
   */
  public async forceUpdate(): Promise<void> {
    try {
      await phishingService.forceUpdate()

      if (PlatformEnv.MANIFEST_VERSION === 'mv3' && chrome.declarativeNetRequest) {
        await this.updateDeclarativeRules()
      }

      log.debug('[Phishing] Forced update completed successfully')
    } catch (error) {
      log.error('[Phishing] Force update failed:', error)
      throw error
    }
  }

  /**
   * Force reload of phishing lists
   * This can be used to fix issues with phishing detection
   */
  public async forceReload(): Promise<void> {
    log.debug('[PhishingController] Force reloading phishing lists')
    try {
      await phishingService.forceUpdate()
      log.debug('[PhishingController] Phishing lists reloaded successfully')

      // Get updated statistics
      const stats = phishingService.getConfig()
      log.debug(
        `[PhishingController] Updated stats: blacklist size: ${stats.blacklist?.length || 0}, whitelist size: ${
          stats.whitelist?.length || 0
        }`
      )

      return Promise.resolve()
    } catch (error) {
      log.error('[PhishingController] Failed to reload phishing lists:', error)
      return Promise.reject(error)
    }
  }

  /**
   * Check if a hostname is in the phishing blacklist
   * @param hostname Hostname to check
   * @returns True if hostname is in blacklist
   */
  public checkPhishing(hostname: string): boolean {
    // Basic validation
    if (!hostname || typeof hostname !== 'string') {
      log.warn(`[PhishingController] Invalid hostname: ${hostname}`)
      return false
    }

    // Get phishing service stats
    const stats = phishingService.getConfig()
    const blacklistSize = stats.blacklist?.length || 0
    const whitelistSize = stats.whitelist?.length || 0

    // If blacklist is empty but whitelist exists, might be an initialization issue
    if (blacklistSize === 0 && whitelistSize > 0) {
      return false
    }

    // Call service to check
    return phishingService.checkPhishing(hostname).isPhishing
  }

  /**
   * Add a hostname to the phishing whitelist
   * @param hostname Hostname to whitelist
   */
  public addToWhitelist(hostname: string): void {
    phishingService.addToWhitelist(hostname)
  }

  /**
   * Get phishing configuration and stats
   * @returns Phishing configuration object
   */
  public getStats(): any {
    return phishingService.getConfig()
  }

  private getWarningPageTarget(senderUrl?: string) {
    if (!senderUrl) return null
    try {
      const sender = new URL(senderUrl)
      const extension = new URL(chrome.runtime.getURL(''))
      if (
        sender.protocol !== extension.protocol ||
        sender.host !== extension.host ||
        sender.pathname !== '/phishing.html'
      ) {
        return null
      }
      const separator = sender.hash.indexOf('?')
      if (separator < 0 || sender.hash.slice(0, separator) !== '#/phishing') return null
      const params = new URLSearchParams(sender.hash.slice(separator + 1))
      return parsePhishingTargetUrl(params.get('href'))
    } catch {
      return null
    }
  }
}

export default new PhishingController()
