# WebRGB provider implementation

The public dApp reference is maintained in
[WebRGB v1 Provider](../../docs/api/webrgb.md). Keep that document aligned with
`src/content-script/pageProvider/webRgb.ts`, the provider RPC handlers, and the
WebRGB tests.

This extension injects the WebRGB v1 adapter at `window.rgb` without
overwriting an existing provider. It announces itself through
`rgb:announceProvider`, answers `rgb:requestProvider` for the page lifetime,
and emits `rgb:ready` when it owns the global slot.

The adapter is deliberately distinct from the experimental native API at
`window.unisat.rgb`, documented in
[Native RGB API](../../docs/api/rgb.md). WebRGB uses safe-integer amounts and
string error codes; the native API uses decimal-string amounts and numeric
wallet error codes.

The upstream contract is the draft
[WebRGB specification](https://github.com/UTEXO-Protocol/webrgb/blob/dev/SPEC.md)
and its [type declarations](https://github.com/UTEXO-Protocol/webrgb/blob/dev/index.d.ts).
UniSat supports only methods advertised by `getInfo().methods`; unsupported
optional methods must continue to reject with `METHOD_NOT_SUPPORTED`.
