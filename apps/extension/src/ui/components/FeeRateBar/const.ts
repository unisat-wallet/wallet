enum FeeRateType {
  SLOW,
  AVG,
  FAST,
  CUSTOM
}

const translationKeys = {
  [FeeRateType.SLOW]: { title: 'slow', desc: 'feerate_slow_desc' },
  [FeeRateType.AVG]: { title: 'avg', desc: 'feerate_avg_desc' },
  [FeeRateType.FAST]: { title: 'fast', desc: 'feerate_fast_desc' }
};

export { MAX_FEE_RATE } from '@unisat/base-utils';

export { FeeRateType, translationKeys };
