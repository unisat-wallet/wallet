import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  isAllowedUiControllerMethod,
  isValidUiDevelopmentRequest,
  isValidUiMessageParams,
} from '../src/utils/ui-message-policy'

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

describe('UI message policy', () => {
  it('allows UI methods and rejects controller internals or prototype members', () => {
    expect(isAllowedUiControllerMethod('getCurrentAccount')).toBe(true)
    expect(isAllowedUiControllerMethod('getRgbFeatureStatus')).toBe(true)
    expect(isAllowedUiControllerMethod('signPsbtV2')).toBe(true)
    expect(isAllowedUiControllerMethod('resetAllData')).toBe(false)
    expect(isAllowedUiControllerMethod('_signPsbt')).toBe(false)
    expect(isAllowedUiControllerMethod('constructor')).toBe(false)
    expect(isAllowedUiControllerMethod('__proto__')).toBe(false)
  })

  it('allows controller methods used by wallet screens and RGB receive', () => {
    for (const method of [
      'boot',
      'abortRgbAcknowledgedSwap',
      'createBuyCoinPaymentUrl',
      'createRgbBlindReceive',
      'createRgbWitnessReceive',
      'approveRgbProxyEndpoints',
      'getBlockActiveInfo',
      'getBRC20RecentHistory',
      'getBRC20Summary',
      'getBuyCoinChannelList',
      'getCoinPrice',
      'getRgbInvoiceExpirySeconds',
      'getRgbProxyApprovalRequirement',
      'queryDomainInfo',
      'setRgbInvoiceExpirySeconds',
    ]) {
      expect(isAllowedUiControllerMethod(method), method).toBe(true)
    }
  })

  it('allows every wallet controller method called by the workspace UI', () => {
    const workspace = resolve(__dirname, '../../..')
    const contractPath = join(workspace, 'packages/wallet-state/src/context/WalletContext.tsx')
    const contract = ts.createSourceFile(contractPath, readFileSync(contractPath, 'utf8'), ts.ScriptTarget.Latest, true)
    const controller = contract.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === 'WalletController'
    )
    expect(controller).toBeDefined()
    const methods = new Set(
      controller!.members
        .filter((member): member is ts.MethodSignature => ts.isMethodSignature(member))
        .map(member => member.name.getText(contract))
    )
    const missing = new Set<string>()
    for (const directory of [
      join(workspace, 'apps/extension/src/ui'),
      join(workspace, 'packages/wallet-state/src'),
    ]) {
      for (const path of listSourceFiles(directory)) {
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text
            if (methods.has(method) && !isAllowedUiControllerMethod(method)) missing.add(method)
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
    expect([...missing].sort()).toEqual([])
  })

  it('accepts safe params and rejects malformed or dangerous values', () => {
    expect(isValidUiMessageParams([{ address: 'bc1qexample', indexes: [0, 1] }])).toBe(true)
    expect(isValidUiMessageParams([{ durationSeconds: 86_400, skipSync: true }])).toBe(true)
    expect(isValidUiMessageParams([{ assetId: 'rgb:example', amount: '1', durationSeconds: 86_400 }])).toBe(true)
    expect(isValidUiMessageParams([{ assetId: undefined, amount: undefined }])).toBe(true)
    const shared = { address: 'bc1qexample' }
    expect(isValidUiMessageParams([shared, shared])).toBe(true)
    expect(isValidUiMessageParams({ address: 'bc1qexample' })).toBe(false)
    expect(isValidUiMessageParams(new Array(11).fill(null))).toBe(false)
    expect(isValidUiMessageParams([Number.POSITIVE_INFINITY])).toBe(false)
    expect(isValidUiMessageParams([() => undefined])).toBe(false)

    const dangerous = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}')
    expect(isValidUiMessageParams([dangerous])).toBe(false)

    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(isValidUiMessageParams([cyclic])).toBe(false)
  })

  it('validates development provider requests separately', () => {
    expect(
      isValidUiDevelopmentRequest({
        data: { method: 'getAccounts', params: {} },
        session: { origin: 'https://example.com' },
      })
    ).toBe(true)
    expect(isValidUiDevelopmentRequest({ method: 'getAccounts', params: [] })).toBe(false)
    expect(isValidUiDevelopmentRequest({ data: { params: [] } })).toBe(false)
  })
})
