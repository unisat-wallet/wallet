## RGB Assets

The following methods help dApps create RGB receive invoices and sign RGB PSBTs with UniSat Wallet.

### createRgbBlindReceive

```
unisat.createRgbBlindReceive(params)
```

Create an RGB blind receive invoice. This method requires user approval.

**Parameters**

- `params` - `object`:
  - `assetId` - `string`: (optional) RGB asset id. Omit this field to receive any RGB asset.
  - `amount` - `number | string`: (optional) amount in the asset's atomic unit. Omit this field to create an any-amount invoice.
  - `minConfirmations` - `number`: (optional) minimum confirmation count.
  - `durationSeconds` - `number`: (optional) invoice duration in seconds.

**Returns**

- `Promise` - `object`:
  - `invoice` - `string`: RGB invoice string.
  - Other fields may be returned by the RGB backend.

**Example**

```javascript
try {
  const res = await window.unisat.createRgbBlindReceive({
    assetId: 'rgb:asset-id',
    amount: '100000000'
  });
  console.log(res.invoice);
} catch (e) {
  console.log(e);
}
```

Create an any-asset, any-amount invoice:

```javascript
const res = await window.unisat.createRgbBlindReceive({});
console.log(res.invoice);
```

---

### createRgbWitnessReceive

```
unisat.createRgbWitnessReceive(params)
```

Create an RGB witness receive invoice. This method requires user approval and requires a fixed amount.

**Parameters**

- `params` - `object`:
  - `assetId` - `string`: (optional) RGB asset id. Omit this field to receive any RGB asset.
  - `amount` - `number | string`: amount in the asset's atomic unit.
  - `minConfirmations` - `number`: (optional) minimum confirmation count.
  - `durationSeconds` - `number`: (optional) invoice duration in seconds.

**Returns**

- `Promise` - `object`:
  - `invoice` - `string`: RGB invoice string.
  - Other fields may be returned by the RGB backend.

**Example**

```javascript
try {
  const res = await window.unisat.createRgbWitnessReceive({
    assetId: 'rgb:asset-id',
    amount: '100000000'
  });
  console.log(res.invoice);
} catch (e) {
  console.log(e);
}
```

---

### getRgbFundingAddress

```
unisat.getRgbFundingAddress()
```

Get the current wallet's RGB funding address.

**Parameters**

none

**Returns**

- `Promise` - `object`:
  - `address` - `string`: RGB funding address.

**Example**

```javascript
try {
  const res = await window.unisat.getRgbFundingAddress();
  console.log(res.address);
} catch (e) {
  console.log(e);
}
```

---

### signRgbPsbt

```
unisat.signRgbPsbt(psbt)
```

Sign an RGB PSBT. This method requires user approval.

**Parameters**

- `psbt` - `string`: PSBT string.

**Returns**

- `Promise` - `string`: signed PSBT hex.

**Example**

```javascript
try {
  const signedPsbt = await window.unisat.signRgbPsbt('cHNidP...');
  console.log(signedPsbt);
} catch (e) {
  console.log(e);
}
```
