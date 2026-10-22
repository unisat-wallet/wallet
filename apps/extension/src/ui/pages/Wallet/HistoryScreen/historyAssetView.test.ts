import { getHistoryTitleKey } from './historyAssetView';

describe('getHistoryTitleKey', () => {
  it('prefers the BRC-20 inscription operation over a receive direction', () => {
    expect(
      getHistoryTitleKey(
        {
          direction: 'receive',
          operation: 'inscribe-transfer'
        },
        true
      )
    ).toBe('brc20_history_type_inscribe_transfer');
  });

  it('keeps existing direction labels when no operation is present', () => {
    expect(getHistoryTitleKey({ direction: 'receive' }, true)).toBe('receive');
    expect(getHistoryTitleKey({ direction: 'send' }, false)).toBe('send');
    expect(getHistoryTitleKey({ direction: 'mixed' }, true)).toBe('mixed');
    expect(getHistoryTitleKey({ direction: 'self' }, false)).toBe('self_transfer');
  });
});
