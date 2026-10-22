import { getHistoryTitle } from './historyAssetView';

describe('getHistoryTitle', () => {
  const t = (key: string) => key;

  it('prefers the backend-localized title over a receive direction', () => {
    expect(
      getHistoryTitle(
        {
          direction: 'receive',
          display: { title: 'Inscribe Transfer' }
        },
        true,
        t
      )
    ).toBe('Inscribe Transfer');
  });

  it('keeps existing direction labels when no display title is present', () => {
    expect(getHistoryTitle({ direction: 'receive' }, true, t)).toBe('receive');
    expect(getHistoryTitle({ direction: 'send' }, false, t)).toBe('send');
    expect(getHistoryTitle({ direction: 'mixed' }, true, t)).toBe('mixed');
    expect(getHistoryTitle({ direction: 'self' }, false, t)).toBe('self_transfer');
  });
});
