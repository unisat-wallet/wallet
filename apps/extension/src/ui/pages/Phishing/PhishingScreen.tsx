import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';

import { useI18n } from '@unisat/wallet-state';

import './PhishingScreen.css';

/**
 * Only allow http(s) navigation after phishing proceed.
 * Blocks chrome-extension:, javascript:, data:, etc. (open-redirect / WAR pivot).
 */
function sanitizeProceedHref(href: string | null, hostname: string | null): string | null {
  if (href) {
    try {
      const u = new URL(href);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.toString();
      }
    } catch {
      // fall through
    }
  }
  if (hostname && /^[a-z0-9.-]+$/i.test(hostname)) {
    return `https://${hostname}`;
  }
  return null;
}

const PhishingScreen = () => {
  const [searchParams] = useSearchParams();
  const hostname = searchParams.get('hostname');
  const href = searchParams.get('href');
  const { t } = useI18n();

  const isFramed = useMemo(() => {
    try {
      return window.top !== window;
    } catch {
      // cross-origin frame access denied ⇒ we are framed
      return true;
    }
  }, []);

  const safeHref = useMemo(() => sanitizeProceedHref(href, hostname), [href, hostname]);

  const handleProceed = async () => {
    if (isFramed) {
      return;
    }
    if (!hostname || !safeHref) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'SKIP_PHISHING_PROTECTION',
      hostname
    });

    window.location.href = safeHref;
  };

  return (
    <div className="phishing-container">
      <div className="phishing-content">
        <div className="phishing-header">
          <img src={chrome.runtime.getURL('/images/logo/wallet-logo.png')} alt="UniSat" className="phishing-logo" />
          <div className="phishing-divider" />
          <div className="phishing-warning-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{t('security_warning')}</span>
          </div>
        </div>

        <div className="phishing-title-section">
          <h1>{t('danger_potential_phishing_website_detected')}</h1>
          <p className="phishing-domain">{hostname}</p>
        </div>

        <div className="phishing-warning-box">
          <p>{t('this_website_has_been_identified_as_malicious_by_unisat_and_may')}</p>
          <ul>
            <li>{t('steal_your_private_keys_or_seed_phrases')}</li>
            <li>{t('trick_you_into_signing_malicious_transactions')}</li>
            <li>{t('collect_your_personal_information')}</li>
          </ul>
        </div>

        <div className="phishing-actions">
          <a
            href="https://github.com/unisat-wallet/phishing-detect/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="phishing-report-link">
            {t('think_this_is_a_false_positive_click_here_to_report_an_issue')}
          </a>
          {isFramed ? (
            <p className="phishing-proceed-text">
              This warning must be opened as a top-level tab (not inside a page iframe). Close this embed and revisit
              the site so UniSat can show a full-page warning.
            </p>
          ) : (
            <p className="phishing-proceed-text">
              {t('if_you_insist_on_continuing_proceed_at_your_own_risk')}
              <button
                onClick={handleProceed}
                className="phishing-proceed-button"
                disabled={!safeHref || !hostname}>
                {t('continue_to')} {hostname}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhishingScreen;
