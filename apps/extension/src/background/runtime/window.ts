import { approvalService } from '@unisat/wallet-background';

import { winMgr } from '../webapi';

export function initWindow() {
  winMgr.event.on('windowRemoved', (winId: number) => {
    approvalService.handleWindowRemoved(winId);
  });

  winMgr.event.on('windowFocusChange', (winId: number) => {
    // todo
  });

  approvalService.platformOpenWindow = async (winProps) => {
    if (approvalService.approvalWindowId) {
      winMgr.remove(approvalService.approvalWindowId);
    }
    const winId = await winMgr.openNotification(winProps);
    if (typeof winId !== 'number' || !Number.isInteger(winId) || winId <= 0) {
      throw new Error('Approval window was not created');
    }
    return winId;
  };

  approvalService.platformCloseWindow = async (winId) => {
    await winMgr.remove(winId);
  };

  approvalService.platformFocusWindow = async (winId) => {
    await winMgr.focus(winId);
  };
}
