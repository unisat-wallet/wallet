/**
 * Phishing detection module
 * Handles phishing site detection and redirection
 */

/**
 * Check if the current site is a phishing site
 * @returns Promise<boolean> - true if the site is phishing
 */
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export async function checkPhishing(): Promise<boolean> {
  if (!isExtensionContextValid()) {
    return false;
  }
  try {
    const hostname = window.location.hostname;
    const isPhishing = await new Promise<boolean>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'CHECK_PHISHING',
          hostname,
          source: 'content_script'
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(response);
        }
      );
    });

    if (isPhishing) {
      if (!isExtensionContextValid()) return true;
      try {
        chrome.runtime.sendMessage(
          {
            type: 'REDIRECT_TO_PHISHING_PAGE',
            hostname
          },
          () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            chrome.runtime.lastError;
          }
        );
      } catch {
        // context invalidated, ignore
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Initialize phishing detection on page load
 */
export async function initializePhishingDetection(): Promise<void> {
  await checkPhishing();
}

/**
 * Setup phishing detection event listeners
 */
export function setupPhishingListeners(): void {
  let checkTimeout: NodeJS.Timeout | null = null;

  // Page navigation listener with debounce
  window.addEventListener('popstate', () => {
    if (checkTimeout) {
      clearTimeout(checkTimeout);
    }
    checkTimeout = setTimeout(checkPhishing, 100);
  });

  // Page visibility change listener
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkPhishing();
    }
  });
}
