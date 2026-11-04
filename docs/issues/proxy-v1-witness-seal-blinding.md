# Bug: Proxy v1 witness seal blinding 未按双方密钥派生

## 问题概述

使用 witness invoice 接收 RGB 资产时，consignment 可以通过 BFA 协议校验，资产 ID、金额和 Bitcoin 收款输出也都正确，但 consignment 中收款 assignment 的 witness seal blinding 与 Proxy v1 规范计算结果不一致。

Proxy v1 要求 witness seal blinding 由以下双方密钥材料共同派生：

- 发送方本次 operation 的 Ed25519 私钥；
- invoice 中接收方的 Ed25519 公钥。

接收方使用自己保存的 invoice 私钥和 Proxy 返回的 `sender_pk`，应当能够派生出完全相同的 blinding。

旧版 UniSat Wallet 在构造 witness recipient assignment 时直接使用随机 `u64`，导致遵循 Proxy v1 规范的接收方无法确认该 assignment 正在支付自己的 invoice。

需要特别说明：Proxy v1 的 Ed25519 临时私钥本来就应当安全随机生成。问题不在临时私钥随机，而在 witness seal blinding 没有使用双方密钥派生。

## 复现条件

- RGB NIA/BFA 资产；
- 使用带 `pk` 和 transport endpoint 的 Proxy v1 witness invoice；
- 发送方为存在该问题的 UniSat Wallet；
- 接收方按照 Proxy v1 A.11 派生并匹配 witness seal blinding，例如 `rgb-lib-bfa`；
- 普通 ACK 模式和先广播 donation 模式均可能复现。

## 复现步骤

1. 接收方创建 Proxy v1 witness invoice。
2. invoice 包含 witness beneficiary、Proxy endpoint 和接收方公钥 `pk`。
3. UniSat Wallet 使用该 invoice 构造并发送 RGB 转账。
4. 从 Proxy 获取 consignment、`sender_pk` 和 `consignment_hash`。
5. 验证 consignment：
   - BFA 校验通过；
   - asset ID 正确；
   - RGB amount 正确；
   - witness output script 和 Bitcoin 金额正确。
6. 使用接收方 invoice 私钥和 `sender_pk` 按 Proxy v1 A.11 派生 blinding。
7. 将派生结果与 consignment recipient assignment 中的 seal blinding 比较。

### 实际结果

两个 blinding 不一致，接收方无法使用标准 Proxy v1 matcher 将 consignment terminal 匹配到 invoice。

### 预期结果

发送方和接收方分别使用自己的私钥及对方公钥，派生出相同的 witness seal blinding；consignment 可以被标准 Proxy v1 接收方识别和接收。

## 根因

旧实现包含两处关键问题：

1. RGB transition 构造阶段直接调用 `randomU64()` 生成 `recipientBlinding`。
2. 发送方 Proxy operation 私钥在 transition 构造完成后才生成，编码器无法使用它派生 blinding。

Proxy v1 适配层虽然已经基于 Ed25519/X25519 共享秘密派生 consignment 加密密钥，但没有使用以下独立 HKDF domain 派生 witness seal blinding：

```text
rgb-proxy-server/enc/v1/seal-blinding
```

规范对应的计算过程为：

```text
shared_secret = X25519(own_ed25519_private_key, peer_ed25519_public_key)
bytes = HKDF-SHA256(shared_secret, info="rgb-proxy-server/enc/v1/seal-blinding", length=8)
seal_blinding = u64_from_little_endian(bytes)
```

## 后果与影响范围

### 互操作失败

UniSat 发送到严格遵循 Proxy v1 的钱包时，接收方可能取得并解密 consignment，也能通过 BFA 校验，但最终无法把 recipient assignment 匹配到 invoice。

典型表现包括：

- 接收方看不到待接收资产；
- 转账停留在 pending/waiting 状态；
- 接收方将 consignment 拒绝；
- 先广播交易已经上链，但接收方仍无法认领对应 RGB 状态。

### Invoice 绑定不完整

如果接收端只按 Bitcoin output script 匹配，而不校验派生 blinding，虽然可能绕过互操作问题，但没有完整执行 Proxy v1 对 invoice 和双方 operation keys 的绑定规则。

### 已生成转账无法原地修正

Seal blinding 已进入 RGB transition commitment。已经生成的错误 consignment 不能只替换一个字段修复，必须重新构造 RGB transition；如果 Bitcoin 交易已经广播，还需要结合实际链上状态单独处理，不能直接复用原 consignment。

### 不受影响的场景

- Proxy v1 临时 Ed25519 私钥随机生成；
- RGB change seal 的随机 blinding；
- 不使用 Proxy transport 的 out-of-band witness recipient；
- blind invoice 自身携带或承诺的 concealed seal。

## 修复方案

修复提交：`191f6922 fix(rgb): derive proxy v1 witness blinding`

修复包括：

1. 在构造 RGB transition 之前生成发送方 Proxy operation 私钥。
2. 将同一发送方私钥同时用于：
   - witness seal blinding 派生；
   - consignment 加密、签名及 Proxy 发布。
3. BFA 和旧 NIA 本地编码路径均使用 Proxy v1 派生值，不再为 Proxy v1 witness recipient 随机生成 blinding。
4. 接收方根据本地 invoice 私钥和 Proxy `sender_pk` 派生预期 blinding，并优先进行精确匹配。
5. 解析 BFA assignment 时保留 revealed seal blinding，供接收端匹配。
6. 对旧版 UniSat 已生成的随机 blinding consignment 保留兼容回退，避免已有待收款记录立即失效。该回退应视为迁移兼容逻辑，后续可结合版本或截止时间逐步收紧。

## 修复后测试方案

建议在 signet 上准备以下环境：

- 一个包含可转移 RGB 资产的发送钱包；
- 一个升级后的 UniSat Wallet；
- 一个基于 `rgb-lib-bfa` 或其他严格实现的对端钱包；
- 双方均使用同一个可访问的 Proxy v1 endpoint；
- Bitcoin 手续费 UTXO 和 RGB carrier UTXO 状态正常。

### 1. 密钥派生单元测试

使用固定的发送方、接收方 Ed25519 私钥：

```text
sender_sk    = 0x11 repeated 32 times
recipient_sk = 0x22 repeated 32 times
```

验证：

- 发送方使用 `sender_sk + recipient_pk` 派生；
- 接收方使用 `recipient_sk + sender_pk` 派生；
- 两边结果完全相同；
- 结果为 `17833752353557286196`；
- 非 32 字节密钥和无效公钥应被拒绝。

### 2. UniSat 发送到标准实现：普通 ACK 模式

1. 标准实现创建带 `pk` 的 witness invoice。
2. UniSat 按 invoice 发送 RGB 资产，不开启 donation。
3. 接收方从 Proxy 获取并解密 consignment。
4. 记录 invoice recipient public key、Proxy `sender_pk` 和 consignment recipient assignment。
5. 双方独立派生 seal blinding。

通过标准：

- 两边派生值相同；
- assignment 中的实际 blinding 等于派生值；
- asset ID、RGB amount、output script 和 output satoshis 均匹配 invoice；
- 接收方可以 ACK；
- 发送方取得 ACK 后可以广播；
- 确认后双方余额和活动记录正确。

### 3. UniSat 发送到标准实现：先广播/donation 模式

1. 使用新的 witness invoice 发起 donation 转账。
2. 发送方先发布 consignment 并广播 Bitcoin 交易，不等待 ACK。
3. 接收方从 Proxy 获取 consignment。

通过标准：

- 即使没有 `ack.prepare/ack.post` 流程，接收方仍能通过 `sender_pk` 派生相同 blinding；
- recipient assignment 能匹配 invoice；
- Bitcoin 交易进入 mempool/confirmed 后，接收资产状态正常推进；
- 不出现 “cannot find a consignment terminal paying this recipient” 类错误。

### 4. 标准实现发送到 UniSat

1. 升级后的 UniSat 创建 witness invoice。
2. 标准实现按 Proxy v1 派生 blinding 并发送。
3. UniSat 获取 consignment。

通过标准：

- UniSat 使用保存的 `proxyPrivateKey` 和返回的 `sender_pk` 得到相同 blinding；
- 优先命中 blinding 精确匹配，而不是 script-only 兼容回退；
- 收款确认、余额更新、checkpoint 保存和钱包恢复后状态一致。

### 5. 旧版本兼容测试

准备一份旧版 UniSat 创建的随机 witness blinding consignment。

通过标准：

- 精确派生匹配失败时，迁移兼容路径仍可识别历史记录；
- 新创建的转账绝不能进入该回退路径；
- 兼容路径不得改变 consignment 内容或尝试重写 commitment；
- 接受、拒绝、重启及 checkpoint 恢复后行为一致。

### 6. 负向测试

分别修改以下任意一项：

- invoice recipient public key；
- Proxy 返回的 `sender_pk`；
- consignment recipient seal blinding；
- recipient output script；
- RGB asset ID；
- RGB amount。

验证派生精确匹配不会错误命中。对于专门构造的旧版兼容样本，应另外确认只有预期的兼容路径可以处理，并在日志或测试结果中明确标识。

### 7. 重试与持久化测试

验证同一笔 pending transfer 在以下情况下不会重新生成 operation key：

- Proxy 请求超时后重试；
- 钱包后台进程重启；
- 等待 ACK 后再次同步；
- donation 发布重试。

通过标准：

- 编码 RGB transition 使用的 sender private key 与发布 consignment 使用的 key 相同；
- `sender_pk`、transfer ID 和 seal blinding 在重试前后保持不变；
- 不产生两个不同 Proxy operation 或不同 RGB commitment。

## 自动化验证

当前修复应至少通过：

```bash
pnpm --filter @unisat/rgb-service typecheck
pnpm --filter @unisat/rgb-service test
pnpm --filter @unisat/rgb-service build
pnpm --filter @unisat/wallet-background test -- rgb-proxy.test.ts
```

修复时的验证结果：

- RGB service：294 passed，1 skipped；
- Proxy transport：33 passed；
- TypeScript typecheck 通过；
- RGB service build 通过。

## 验收标准

- UniSat 发送的 Proxy v1 witness transfer 可被标准 `rgb-lib-bfa` 接收端匹配；
- UniSat 可以精确匹配标准发送方产生的 witness seal blinding；
- 普通 ACK 和先广播/donation 两种流程均通过；
- 新转账不再使用随机 recipient witness blinding；
- 旧版待处理转账仍可通过兼容路径恢复；
- 钱包重启、Proxy 重试和 checkpoint 恢复不会改变 sender operation key 或 blinding。
