import { useChain, useI18n, useNavigation } from '@unisat/wallet-state';

import { Image } from '../Image';
import { Text } from '../Text';
import styles from './asset-empty.module.less';

/** Centered empty state for asset balances on the Assets screen. */
export function AssetEmptyState({ marketplacePath }: { marketplacePath?: string }) {
  const { t } = useI18n();
  const nav = useNavigation();
  const chain = useChain();

  return (
    <div className={styles.viewportCenter}>
      <div className={styles.content}>
        <div className={styles.message}>
          <Image src="./images/icons/status/empty-box.svg" width={85} height={59} />
          <Text text={t('assets_no_assets')} size="sm" textCenter style={{ color: 'rgba(255, 255, 255, 0.45)' }} />
        </div>
        {chain.enableMarket !== false && (
          <button type="button" className={styles.marketButton} onClick={() => {
            if (marketplacePath) window.open(`${chain.unisatUrl}${marketplacePath}`);
            else nav.navToMarketPlace();
          }}>
            {t('go_to_marketplace')}
            <span className={styles.arrow} aria-hidden="true">
              <img src="/images/history/view-all-arrow.svg" alt="" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
