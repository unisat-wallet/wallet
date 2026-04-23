import React, { CSSProperties } from 'react';

import { ColorTypes, colors } from '@/ui/theme/colors';
import { fontSizes } from '@/ui/theme/font';

export const svgRegistry = {
  // nav
  history: '/images/icons/tx/clock-solid.svg',
  right: '/images/icons/nav/right.svg',
  left: '/images/icons/nav/arrow-left.svg',
  down: '/images/icons/nav/down.svg',
  up: '/images/icons/nav/up.svg',
  link: '/images/icons/nav/arrow-up-right.svg',
  'inscribe-right': '/images/icons/nav/inscribe-right.svg',
  'arrow-right': '/images/icons/nav/right.svg',
  arrowUp: '/images/icons/nav/arrowup.svg',
  drop_down: '/images/icons/nav/drop_down.svg',

  // tab
  user: '/images/icons/tab/user.svg',
  wallet: '/images/icons/tab/wallet.svg',
  assets: '/images/icons/tab/assets.svg',
  compass: '/images/icons/tab/compass-solid.svg',
  settings: '/images/icons/tab/settings.svg',
  grid: '/images/icons/tab/grid.svg',

  // action
  send: '/images/icons/action/send.svg',
  send_grey: '/images/icons/action/send_grey.svg',
  receive: '/images/icons/action/qrcode.svg',
  qrcode: '/images/icons/action/qrcode.svg',
  copy: '/images/icons/action/copy.svg',
  pencil: '/images/icons/action/pencil.svg',
  delete: '/images/icons/action/delete.svg',
  split: '/images/icons/action/scissors.svg',
  merge: '/images/icons/action/merge.svg',
  mint_action: '/images/icons/action/mint_action.svg',
  burn: '/images/icons/action/burn.svg',
  unlock: '/images/icons/action/unlock.svg',
  sortAddress: '/images/icons/action/sort-address.svg',
  sortTop: '/images/icons/action/sort-top.svg',
  sortDrag: '/images/icons/action/sort-drag.svg',
  more: '/images/icons/action/more.svg',
  moreInfo: '/images/icons/action/moreinfo.svg',
  eye: '/images/icons/action/eye.svg',
  'eye-slash': '/images/icons/action/eye-slash.svg',
  close: '/images/icons/action/xmark.svg',
  'sheet-close': '/images/icons/action/sheet-close.svg',
  userContact: '/images/icons/action/user-contact.svg',
  search: '/images/icons/action/search.svg',
  filter: '/images/icons/action/filter.svg',
  add_liquidity: '/images/icons/action/add_liquidity.svg',

  // status
  success: '/images/icons/status/success.svg',
  warning: '/images/icons/status/warning.svg',
  alert: '/images/icons/status/alert.svg',
  risk: '/images/icons/status/risk.svg',
  info: '/images/icons/status/info.svg',
  check: '/images/icons/status/check.svg',
  checked: '/images/icons/status/checked.svg',
  'circle-check': '/images/icons/status/circle-check.svg',
  'circle-info': '/images/icons/status/circle-info.svg',
  'circle-question': '/images/icons/status/circle-question.svg',
  'error-boundary': '/images/icons/status/error-boundary.svg',
  paused: '/images/icons/status/paused.svg',
  overview: '/images/icons/status/overview.svg',
  notification: '/images/icons/status/notification.svg',
  emptyBox: '/images/icons/status/empty-box.svg',

  // settings
  addressType: '/images/icons/settings/address-type.svg',
  addressBook: '/images/icons/settings/address-book.svg',
  addressBookEmpty: '/images/icons/settings/address-book-empty.svg',
  advance: '/images/icons/settings/advance.svg',
  connectedSites: '/images/icons/settings/connected-sites.svg',
  network: '/images/icons/settings/network.svg',
  changePassword: '/images/icons/settings/change-password.svg',
  language: '/images/icons/settings/language.svg',
  aboutUsLogo: '/images/icons/settings/about-us.svg',
  aboutus: '/images/icons/settings/aboutus.svg',
  rateUs: '/images/icons/settings/rate-us.svg',
  feedback: '/images/icons/settings/feedback.svg',
  apidocs: '/images/icons/settings/apidocs.svg',
  'version-notice': '/images/icons/settings/version-notice.svg',
  'side-panel-logo': '/images/icons/settings/side-panel-logo.svg',
  'side-panel-logo-close': '/images/icons/settings/side-panel-logo-close.svg',

  // social
  discord: '/images/icons/social/discord.svg',
  twitter: '/images/icons/social/twitter.svg',
  github: '/images/icons/social/github.svg',
  telegram: '/images/icons/social/telegram.svg',
  website: '/images/icons/social/website.svg',
  offcial: '/images/icons/social/offcial.svg',
  fb: '/images/icons/social/fb.svg',
  email: '/images/icons/social/email.svg',
  medium: '/images/icons/social/medium.svg',

  // protocol
  bitcoin: '/images/icons/protocol/bitcoin.svg',
  btc: '/images/icons/protocol/btc.svg',
  ordinals: '/images/icons/protocol/ordinals.svg',
  atomicals: '/images/icons/protocol/atomicals.svg',
  unisat: '/images/icons/protocol/unisat.svg',
  gas: '/images/icons/protocol/gas.svg',

  // tx
  utxo: '/images/icons/tx/utxo.svg',
  utxobg: '/images/icons/tx/utxobg.svg',
  history_send: '/images/icons/tx/history_send.svg',
  history_receive: '/images/icons/tx/history_receive.svg',
  history_inscribe: '/images/icons/tx/history_inscribe.svg',
  history_wrap: '/images/icons/tx/history_wrap.svg',
  history_unwrap: '/images/icons/tx/history_unwrap.svg',
  psbt_input: '/images/icons/tx/psbt_input.svg',
  psbt_output: '/images/icons/tx/psbt_output.svg',
  psbt_opreturn: '/images/icons/tx/psbt_opreturn.svg',
  'brc20-single-step': '/images/icons/tx/brc20-single-step.svg',

  // swap
  swap_swap: '/images/icons/swap/swap_swap.svg',
  swap_more: '/images/icons/swap/swap_more.svg',
  swap_wrap: '/images/icons/swap/wrap.svg',
  swap_unwrap: '/images/icons/swap/swap_withdraw.svg',
  swap_send: '/images/icons/swap/swap_send.svg',
  trade: '/images/icons/swap/trade.svg',

  // babylon
  baby: '/images/icons/babylon/baby.svg',
  'claimable-baby': '/images/icons/babylon/claimable-baby.svg',
  'claimed-baby': '/images/icons/babylon/claimed-baby.svg',
  'staked-btc': '/images/icons/babylon/staked-btc.svg',
  'baby-tip1': '/images/icons/babylon/baby-tip1.svg',
  'baby-tip2': '/images/icons/babylon/baby-tip2.svg',
  'baby-delegation': '/images/icons/babylon/baby-delegation.svg',
  'baby-stakers': '/images/icons/babylon/baby-stakers.svg',
  'baby-staking': '/images/icons/babylon/baby-staking.svg',
  'baby-tvl': '/images/icons/babylon/baby-tvl.svg',

  // action (balance toggles)
  'balance-eyes': '/images/icons/action/balance-eyes.svg',
  'balance-eyes-closed': '/images/icons/action/balance-eyes-closed.svg',
  'balance-question': '/images/icons/action/balance-question.svg',
  'balance-right': '/images/icons/action/balance-right.svg',
  'balance-unlock-right': '/images/icons/action/balance-unlock-right.svg',

  // artifacts
  'singer-info': '/images/icons/artifacts/singer-info.svg',
  'singer-logo': '/images/icons/artifacts/singer-logo.svg',

  // unisat
  unisat_titles: '/images/icons/unisat/titles.svg',
  unisat_points: '/images/icons/unisat/points.svg',
  unisat_credits: '/images/icons/unisat/credits.svg',
  unisat_titles_badge: '/images/icons/unisat/titles-badge.svg',
  unisat_points_gem: '/images/icons/unisat/points-gem.svg',
  unisat_credits_coin: '/images/icons/unisat/credits-coin.svg'
};

const iconImgList: Array<IconTypes> = [
  'success',
  'delete',
  'btc',
  'baby',
  'staked-btc',
  'claimable-baby',
  'claimed-baby',
  'baby-tip1',
  'baby-tip2',
  'error-boundary',
  'utxobg',
  'addressType',
  'addressBook',
  'advance',
  'connectedSites',
  'network',
  'changePassword',
  'addressBookEmpty',
  'feedback',
  'apidocs',
  'medium',
  'email',
  'arrowUp',
  'aboutus',
  'moreInfo',
  'aboutUsLogo',
  'rateUs',
  'checked',
  'language',
  'receive',
  'send',
  'history',
  'utxo',
  'balance-right',
  'balance-eyes',
  'balance-eyes-closed',
  'balance-question',
  'balance-unlock-right',
  'brc20-single-step',
  'arrow-right',
  'version-notice',
  'side-panel-logo',

  'history_send',
  'history_receive',
  'history_inscribe',
  'history_wrap',
  'history_unwrap',

  'psbt_input',
  'psbt_output',
  'psbt_opreturn',
  'notification',
  'unlock',

  'unisat_titles',
  'unisat_points',
  'unisat_credits',
  'unisat_titles_badge',
  'unisat_points_gem',
  'unisat_credits_coin',

  'emptyBox',
  'mint_action',
  'trade'
];

export type IconTypes = keyof typeof svgRegistry;
interface IconProps {
  /**
   * The name of the icon
   */
  icon?: IconTypes;

  /**
   * An optional tint color for the icon
   */
  color?: ColorTypes;

  /**
   * An optional size for the icon..
   */
  size?: number | string;

  /**
   * Style overrides for the icon image
   */
  style?: CSSProperties;

  /**
   * Style overrides for the icon container
   */
  containerStyle?: CSSProperties;

  /**
   * An optional function to be called when the icon is clicked
   */
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  children?: React.ReactNode;
  'data-testid'?: string;
}

export function Icon(props: IconProps) {
  const {
    icon,
    color,
    size,
    style: $imageStyleOverride,
    containerStyle: $containerStyleOverride,
    onClick,
    children,
    'data-testid': dataTestId
  } = props;
  if (!icon) {
    return (
      <div
        onClick={onClick}
        style={Object.assign(
          {},
          {
            color: color ? colors[color] : '#FFF',
            fontSizes: size || fontSizes.icon,
            display: 'flex'
          } as CSSProperties,
          $containerStyleOverride,
          $imageStyleOverride || {},
          onClick ? { cursor: 'pointer' } : {}
        )}
        data-testid={dataTestId}>
        {children}
      </div>
    );
  }
  const iconPath = svgRegistry[icon as IconTypes];
  if (iconImgList.includes(icon)) {
    return (
      <img
        onClick={onClick}
        src={iconPath}
        alt=""
        style={Object.assign({}, $containerStyleOverride, {
          width: size || fontSizes.icon,
          height: size || fontSizes.icon,
          cursor: onClick ? 'pointer' : 'default'
        })}
      />
    );
  }
  if (iconPath) {
    return (
      <div style={$containerStyleOverride}>
        <div
          onClick={onClick}
          style={Object.assign(
            {},
            {
              color: color ? colors[color] : '#FFF',
              width: size || fontSizes.icon,
              height: size || fontSizes.icon,
              backgroundColor: color ? colors[color] : '#FFF',
              maskImage: `url(${iconPath})`,
              maskSize: 'cover',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
              WebkitMaskImage: `url(${iconPath})`,
              WebkitMaskSize: 'cover',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center'
            },
            $imageStyleOverride || {},
            onClick ? { cursor: 'pointer' } : {}
          )}
          data-testid={dataTestId}
        />
      </div>
    );
  } else {
    return <div />;
  }
}
