import { Column, Progress, Row, Text } from '@/ui/components';
import { colors } from '@/ui/theme/colors';
import { useI18n, type RgbAcceptProgressPhase, type RgbAcceptUiProgress } from '@unisat/wallet-state';

const phasePercent: Record<RgbAcceptProgressPhase, number> = {
  preparing: 5,
  checking: 15,
  validating: 40,
  persisting: 60,
  acknowledging: 75,
  broadcasting: 88,
  finalizing: 96,
  complete: 100
};

const phaseTranslationKey: Record<RgbAcceptProgressPhase, string> = {
  preparing: 'rgb_accept_progress_preparing',
  checking: 'rgb_accept_progress_checking',
  validating: 'rgb_accept_progress_validating',
  persisting: 'rgb_accept_progress_persisting',
  acknowledging: 'rgb_accept_progress_acknowledging',
  broadcasting: 'rgb_accept_progress_broadcasting',
  finalizing: 'rgb_accept_progress_finalizing',
  complete: 'rgb_accept_progress_complete'
};

function getProgressPercent(progress: RgbAcceptUiProgress) {
  if (progress.phase === 'complete') return 100;
  if (progress.total <= 1) return phasePercent[progress.phase];
  const completed = Math.min(progress.completed, progress.total);
  const itemProgress = phasePercent[progress.phase] / 100;
  return Math.min(99, ((completed + itemProgress) / progress.total) * 100);
}

export function RGBAcceptProgress({ progress }: { progress: RgbAcceptUiProgress }) {
  const { t } = useI18n();
  const percent = getProgressPercent(progress);
  const completed = Math.min(progress.completed, progress.total);

  return (
    <Column
      fullX
      gap="sm"
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'rgba(255,255,255,0.06)',
        boxSizing: 'border-box'
      }}>
      <Row fullX justifyBetween itemsCenter gap="sm">
        <Text text={t(phaseTranslationKey[progress.phase])} color="white" wrap />
        <Text
          text={progress.total > 1 ? `${completed}/${progress.total}` : `${progress.elapsedSeconds}s`}
          color="textDim"
          style={{ flexShrink: 0 }}
        />
      </Row>
      <Progress percent={percent} showInfo strokeColor={colors.primary} size="small" />
      {progress.total > 1 ? (
        <Text
          text={`${t('rgb_accept_progress_elapsed')} ${progress.elapsedSeconds}s`}
          color="textDim"
          size="xs"
        />
      ) : null}
      {progress.elapsedSeconds >= 20 ? (
        <Text text={t('rgb_accept_progress_slow')} color="textDim" size="xs" wrap />
      ) : null}
    </Column>
  );
}
