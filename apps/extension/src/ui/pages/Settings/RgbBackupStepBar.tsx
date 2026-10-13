import { Row } from '@/ui/components';
import { TabBar } from '@/ui/components/TabBar';

export function RgbBackupStepBar({ step, labels, onStepClick }: { step: 1 | 2 | 3; labels: string[]; onStepClick: (step: 1 | 2 | 3) => void }) {
  return (
    <Row justifyCenter fullX>
      <TabBar
        preset="number-step"
        progressEnabled
        activeKey={step}
        numberStepList={labels}
        items={([1, 2, 3] as const).map((key) => ({ key, label: String(key) }))}
        onTabClick={(key) => {
          const target = Number(key);
          if (target < step && (target === 1 || target === 2)) onStepClick(target);
        }}
      />
    </Row>
  );
}
