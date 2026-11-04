# Bug: RGB validation failure 仅允许 Reject，拒绝后删除 Proxy v1 私钥导致无法恢复

## 问题概述

Proxy v1 receive invoice 会生成一组随机 Ed25519 operation keys：

- 公钥写入 invoice 并注册到 Proxy；
- 私钥 `proxyPrivateKey` 保存在本地 `pendingReceives` 中；
- 接收方使用该私钥查询 Proxy、验证签名、解密 consignment，并与发送方 `sender_pk` 派生 witness seal blinding。

本案例不是一个已经校验成功的正常收款确认。Consignment 到达后首先进入了
`validation_failed`，详情页只有 Reject 按钮，没有 Accept 按钮。用户在该状态下点击
Reject 后，钱包会：

1. 尝试向 Proxy 发送 NACK；
2. 在 receive history 中记录 `Rejected by you`；
3. 从 `pendingReceives` 中删除整条 receive；
4. 随该记录一起删除 invoice、`proxyPrivateKey`、待处理 consignment 和验证上下文；
5. 将删除后的状态持久化并写入后续 recovery checkpoint。

`proxyPrivateKey` 是安全随机生成的临时私钥，不能从钱包助记词、funding address、wallet ID 或 recipient ID 重新派生。因此，即使 Proxy 仍保存着加密 consignment，钱包也可能永远无法再次解密和校验它。

## 已观察到的现象

接收端实际 UI 表现为：

- 没有 Accept 按钮；
- 只有 Reject 按钮；
- 这对应 `pendingValidationFailure`/`validation_failed` 分支，而不是正常的
  `pendingAccept` 分支。

接收地址的最终本地活动记录显示：

```text
type: receive
status: rejected
rejectionReason: Rejected by you
```

该历史文案不能反向证明 consignment 曾经校验成功。部署版本可能在 Reject 后只保留
`Rejected by you`，而把此前的 validation failure 详情随 `pendingReceive` 一起删除。

同时可能出现：

- `rgb_local_recipient_claim` 中仍有该 recipient ID；
- wallet-api 的 `rgb_local_consignment` 中没有对应 payload；
- Proxy v1 中仍能找到 invoice 和 transfer；
- donation/先广播转账没有 `ack.prepare` 记录；
- 最新本地状态和 recovery checkpoint 中已没有对应 `pendingReceive`；
- 无法重新查询、解密或接收该 consignment。

Proxy v1 payload 直接保存在 Proxy，并不一定写入 wallet-api 的 `rgb_local_consignment`，所以该表没有记录本身不代表发送方没有上传 consignment。

已对 consignment 进行的独立检查显示：BFA、asset ID、RGB amount 和收款 output 均可匹配，
但 witness seal blinding 与使用 invoice key 和 Proxy `sender_pk` 按规范派生的结果不一致。
这可以解释为什么接收状态进入 `validation_failed`，但需要取回拒绝前的
`proxyPrivateKey` 才能最终确认是发送方生成了错误 blinding，还是接收端使用了错误的
invoice key material。

## 因果关系

本案例包含三个连续但不同的问题：

1. **触发 validation failure**：consignment 无法完整匹配 invoice；目前最明确的差异是
   witness seal blinding。
2. **无法提交协议 Reject**：发送方采用 broadcast-first/donation，没有执行
   `ack.prepare`，所以 Proxy 不存在 ACK operation，`ack.post(false)` 返回 operation not
   found。
3. **变成不可恢复**：客户端忽略 operation not found，仍删除 `pendingReceive` 和其中唯一的
   `proxyPrivateKey`。

Donation 本身不会导致 validation failure，也不会必然导致收款失败；它只使本次 Reject
无法写入 Proxy，并放大了删除本地恢复密钥的后果。

## 复现条件

- 使用带 `pk` 的 Proxy v1 receive invoice；
- 接收方已收到或发现 consignment；
- consignment 因 blinding mismatch、客户端兼容问题或其他原因进入
  `pendingValidationFailure`；
- UI 仅显示 Reject，没有 Accept；
- 用户点击 Reject；
- 发送方使用 donation/先广播模式，使 Proxy 上没有可写入的 ACK operation。

## 复现步骤

1. 接收方创建 Proxy v1 witness invoice。
2. 确认本地 `pendingReceives` 中存在：
   - `invoice`；
   - `proxyPrivateKey`；
   - `proxyPublicKey`；
   - `proxyInvoiceId`。
3. 发送方向该 invoice 上传 consignment。
4. 接收方发现 consignment，但 invoice matcher 返回不匹配，状态进入
   `validation_failed`。
5. 确认详情页只有 Reject，没有 Accept。
6. 用户点击 Reject。
7. Proxy 的 `ack.post(false)` 因缺少 ACK operation 返回 operation not found。
8. 检查本地 RGB state 和最新 recovery checkpoint。
9. 重启钱包或从 checkpoint 恢复，再次尝试获取该 transfer。

### 实际结果

- 对应记录从 `pendingReceives` 消失；
- `proxyPrivateKey` 被删除；
- history 只保留 rejected 状态及少量展示信息；
- 即使 Proxy 文件仍存在，也无法重新解密；
- 钱包恢复、重新安装或导入助记词均不能重建该随机私钥；
- Proxy transfer 仍保持 `pending`，consignment 文件和文件哈希均正常。

### 预期结果

Validation failure 应保持可重新检查；即使用户选择 Reject，也不应立即销毁恢复该
receive 所需的唯一密钥材料，尤其是在 Proxy 明确表示不存在 ACK operation 时。

至少应当：

- 将 receive 转为 rejected tombstone，而不是直接删除；
- 在加密本地状态和 recovery checkpoint 中继续保留 `proxyPrivateKey`；
- 明确区分不可逆的标准 NACK 与仅发生在本地的 donation reject；
- 只有在明确的安全清理条件满足后，才允许销毁私钥和 payload。

## 根因

### 触发只有 Reject 的直接原因

接收状态机只有在 consignment 校验成功并写入 `pendingAccept` 时才展示 Accept + Reject。
本案例只有 Reject，证明此前走的是 `pendingValidationFailure` 分支。

根据现有数据，最可能的 matcher 差异是 witness seal blinding。Blinding 由发送方构造 RGB
transition 时决定，因此如果 invoice 私钥与 invoice 公钥确实匹配，而 consignment blinding
仍与双方密钥派生结果不同，则错误来自发送方实现或发送方版本。

这也解释了为什么不是所有用户都会触发：

- 发送方生成符合 Proxy v1 的 consignment：校验成功，显示 Accept + Reject；
- 发送方随机或错误派生 witness blinding：校验失败，只显示 Reject；
- 不同发送钱包、不同版本或不同 transfer path 会产生不同结果。

### 无法恢复的直接原因

`rejectReceiveOnce()` 在记录 rejected history 后执行：

```ts
state.pendingReceives = pending.filter(item => item !== receive)
```

`proxyPrivateKey` 是 `RgbPendingReceive` 的字段，没有被单独归档到 rejected history 或专用 tombstone 中。

当前实现基于“Proxy recipient ID 是一次性的，拒绝后不能接收另一份文件”的前提删除 invoice。这个前提可以禁止 invoice 再次使用，但不等于必须立即销毁解密历史文件所需的私钥。

这里混合了两个不同动作：

- 业务动作：拒绝当前 transfer、禁止 recipient ID 再次使用；
- 数据销毁：永久删除该 recipient 的随机私钥和恢复上下文。

前者不必自动触发后者。

## 为什么私钥无法恢复

Proxy v1 invoice key 是独立随机 Ed25519 key，不是从以下材料确定性派生：

- 钱包助记词；
- RGB funding key；
- Bitcoin address；
- invoice recipient ID；
- Proxy invoice ID。

公钥、invoice ID 和 encrypted consignment 都不能反推出私钥。删除 `proxyPrivateKey` 后，只剩密码学上不可逆的公开信息。

## 后果与影响范围

### 误拒绝永久丢失恢复能力

如果拒绝原因来自客户端 bug、错误的 blinding 匹配、短暂索引异常或错误的 validation result，修复客户端后仍无法重新处理原 consignment。

本案例的用户并没有面对一个可选择 Accept 的正常收款提示，而是在 validation failure 后只
能看到 Reject。这使用户更容易把 Reject 理解为关闭错误提示，而不是永久销毁随机恢复密钥。

### Donation/先广播场景风险更高

Donation 模式通常不存在 sender ACK operation：

- 发送方可能已经广播 Bitcoin 交易；
- `ack.post(false)` 可能返回 operation not found；
- 当前实现仍将其视为本地拒绝并删除 receive；
- 链上交易继续存在，但接收方失去解密和认领 RGB 状态的密钥。

### Recovery checkpoint 会固化删除结果

未拒绝时，`pendingReceives` 会进入加密 recovery checkpoint，其中包含 `proxyPrivateKey`。Reject 后生成的新 checkpoint 不再包含该记录，跨设备恢复也无法找回。

### 普通 NACK 与本地 Reject 语义不清

- 普通 ACK 流程中，向 Proxy 提交 NACK 可能是协议层不可逆操作，发送方会停止该 transfer；
- Donation 模式没有对应 ACK operation，Reject 只是本地状态变化；
- UI 和存储层当前都将二者表现为相同的 `Rejected by you`，但恢复能力和链上后果不同。

## 不点击 Reject 时是否可以恢复

通常可以。

只要 receive 仍保留在 `pendingReceives` 中，并且包含 `proxyPrivateKey`：

- 钱包可以继续从 Proxy 查询 transfer；
- 可以重新解密 consignment；
- 修复客户端校验逻辑后可以重新验证；
- 重启或从包含该 pending receive 的 recovery checkpoint 恢复后仍可继续处理。

能否最终接收还取决于 Proxy retention、Bitcoin 交易状态和 consignment 本身是否有效，但至少不会因为本地随机私钥被删除而失去恢复能力。

## 建议修复方案

### 1. 使用 rejected tombstone 代替立即删除

Reject 后保留最小必要恢复数据：

- recipient ID 和 proxy recipient ID；
- invoice；
- `proxyPrivateKey` 和 `proxyPublicKey`；
- `proxyInvoiceId`；
- Proxy endpoint；
- transfer ID、`sender_pk` 和 consignment hash；
- validation failure 和 rejected reason；
- rejected 类型：`proxy_nack` 或 `local_donation_reject`；
- rejectedAt 和 retention deadline。

这些内容必须继续保存在加密本地状态和加密 recovery checkpoint 中，不应进入日志或普通后台分析接口。

### 2. 区分两种拒绝

#### 标准 Proxy NACK

- 已成功提交 `ack.post(false)`；
- 协议结果应保持 rejected，不允许普通 Accept 按钮直接反转；
- 仍可暂时保留私钥用于审计、重新验证和故障诊断；
- 到达明确 retention deadline 后可安全清理。

#### Donation/本地 Reject

- Proxy 返回 ACK operation not found，或 transfer 明确为 donation；
- 不应假装已经通知发送方；
- 如果 Bitcoin 交易已广播，建议允许用户在修复校验问题后执行“重新检查”或“恢复接收”；
- UI 必须说明这只是本地隐藏/拒绝，不会撤销链上交易。
- Validation failure 页面不应只提供一个会销毁恢复材料的 Reject 操作；至少还应提供
  “稍后处理/重新检查”。

### 3. 分离 Reject 与永久删除

新增独立的永久清理操作，例如：

```text
Forget rejected receive permanently
```

执行前应：

- 显示不可恢复警告；
- 明确说明私钥不能由助记词恢复；
- 要求二次确认；
- 对已广播但未结算的 donation 禁止或延迟清理；
- 完成最新 recovery checkpoint 后才报告成功。

### 4. 保留 recipient ID 单次使用约束

保留 tombstone 不代表 invoice 可以再次收款：

- 原 recipient ID 仍应标记为 consumed/rejected；
- 创建新收款必须生成新的 invoice 和 key pair；
- tombstone 仅用于恢复、重新验证和审计原 transfer。

### 5. 避免敏感数据泄露

- 禁止打印 `proxyPrivateKey`；
- 禁止把私钥加入公开 API、活动记录或 MongoDB 分析表；
- tombstone 和 checkpoint 必须继续使用现有钱包加密边界；
- 后台诊断只返回 `hasRecoveryKey: true/false` 等布尔状态。

## 修复后测试方案

### 1. 未 Reject 的恢复基线

1. 创建 Proxy v1 invoice。
2. 收到 consignment，但不点击 Reject。
3. 重启钱包并重新打开。
4. 再从 recovery checkpoint 恢复到另一设备。

通过标准：

- `proxyPrivateKey` 在加密状态中保持不变；
- 能重新查询并解密同一 consignment；
- transfer ID、sender public key 和 consignment hash 保持一致。

### 2. 普通 ACK transfer 的 Reject

1. 发送方完成 `ack.prepare`。
2. 接收方点击 Reject。
3. 确认 `ack.post(false)` 成功。
4. 重启并从 checkpoint 恢复。

通过标准：

- 状态为不可逆的 `proxy_nack`；
- 普通 Accept 操作被禁止；
- rejected tombstone 和私钥仍存在；
- 不再重复发送 NACK；
- 不允许另一个 transfer 复用该 recipient ID；
- 到 retention deadline 前可以进行只读解密和诊断。

### 3. Donation/先广播 transfer 的 Reject

1. 发送方不创建 ACK operation，直接上传 consignment 并广播交易。
2. 使用错误 witness blinding 或测试 matcher 注入 validation mismatch。
3. 确认接收端状态为 `validation_failed`，页面只有 Reject，没有 Accept。
4. 接收方点击 Reject。
5. Proxy 返回 operation not found。
6. 修复或切换到可正确验证该 consignment 的客户端版本。
7. 执行“重新检查”或“恢复接收”。

通过标准：

- 状态记录为 `local_donation_reject`；
- 不删除 `proxyPrivateKey`；
- validation failure 原因仍可查询，不会被扁平化成只有 `Rejected by you`；
- 能重新获取或使用保留的 consignment；
- 能重新派生 witness blinding 并完成验证；
- 已广播交易确认后可以继续结算 RGB allocation；
- UI 不声称已经撤销链上交易或通知发送方。

### 4. Validation mismatch 后升级恢复

1. 使用旧客户端制造可复现的 validation mismatch。
2. 不永久删除 receive，将其转为 rejected tombstone。
3. 升级到修复版客户端。
4. 重新运行 validation。

通过标准：

- 原 invoice 私钥仍可使用；
- 同一 Proxy payload 可以重新解密；
- 修复后的校验可以找到 recipient assignment；
- 不需要发送方重新上传原 consignment。

### 5. 永久清理测试

1. 对已超过 retention deadline 的 rejected tombstone 执行永久清理。
2. 完成持久化和 recovery checkpoint。
3. 重启及跨设备恢复。

通过标准：

- tombstone 中的私钥和 payload 被删除；
- history 仍保留不含敏感信息的 rejected 展示记录；
- recipient ID 仍保持 consumed，不能重新使用；
- UI 在清理前明确提示该操作不可恢复。

### 6. Checkpoint 冲突与多设备测试

1. 设备 A 发现 transfer；
2. 设备 B 从较早 checkpoint 打开同一钱包；
3. 设备 A 执行 Reject；
4. 设备 B 同步最新 checkpoint。

通过标准：

- lease/fencing 保证只有有效写入者提交状态；
- 两台设备最终看到同一个 rejected 类型；
- tombstone 私钥不会因状态合并或 checkpoint 覆盖意外丢失；
- 不会重复 ACK/NACK。

### 7. 安全和日志测试

检查：

- 应用日志；
- 错误上报；
- wallet-api 请求日志；
- MongoDB 活动和诊断集合；
- 管理后台响应。

通过标准：

- 所有位置都不包含 `proxyPrivateKey`；
- 只有钱包加密状态和加密 checkpoint 保存恢复密钥；
- 诊断界面最多显示私钥是否存在，不显示具体值。

## 验收标准

- Validation failure 状态明确显示失败原因，并提供“稍后处理/重新检查”，不能只留下会永久
  销毁密钥的 Reject；
- Reject 不再立即销毁 Proxy v1 随机私钥；
- 普通 NACK 和 donation 本地拒绝具有不同状态与 UI 文案；
- 未 Reject 的 pending receive 在重启和 checkpoint 恢复后仍可处理；
- donation 本地拒绝在客户端修复后可以重新检查和恢复；
- 标准 NACK 不会被错误反转或重复提交；
- recipient ID 保持单次使用；
- 永久删除必须是独立、明确且不可恢复的用户操作；
- 私钥不会进入日志、公开 API 或后台数据库。
