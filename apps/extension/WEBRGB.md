# WebRGB provider

The extension injects a WebRGB v1 provider at `window.rgb` and announces it with
`rgb:ready` and `rgb:announceProvider`. It answers `rgb:requestProvider` throughout
the page lifetime. An existing provider in the `window.rgb` slot is left intact.
The existing `window.unisat.rgb` experimental API remains available.

Call `await window.rgb.enable()` before any other method. Connection uses the
wallet's site approval; reads require that approval but do not prompt again.
`getInfo().methods` is the capability list for the current RGB runtime.

Supported on an enabled RGB L1 wallet: `getInfo`, `getAddress`, `blindReceive`,
`witnessReceive`, `listAssets`, `getAssetBalance`, `sendAsset`, `listTransfers`,
`getTransferStatus`, `decodeRgbInvoice`, `on`, and `off`. The provider uses the
wallet's existing receive and send approval screens. WebRGB receives settle only
after at least three Bitcoin confirmations, or a higher requested floor.

`issueAsset` is not advertised because the wallet's current dApp issuance flow
requires an order ID and payment that WebRGB's `issueAsset` arguments cannot
represent. `burnAsset`, `getConsignment`, `signMessage` (LND zbase32 format),
`makeLnInvoice`, and `payLnInvoice` are also not advertised. Calls to these
methods reject with `METHOD_NOT_SUPPORTED`. The wallet reports `RGB_L1`, not
`RGB_LN`.

For an invoice that omits the amount, `sendAsset` requires an explicit `amount`.
For an invoice that omits the asset ID, it requires an explicit `assetId` if the
wallet holds more than one RGB asset. Both values are positive JavaScript safe
integers in base units. Each send obtains the normal payment and signature
approvals before broadcasting.

The adapter follows the [WebRGB SPEC](https://github.com/UTEXO-Protocol/webrgb/blob/dev/SPEC.md)
and its [type declarations](https://github.com/UTEXO-Protocol/webrgb/blob/dev/index.d.ts).
