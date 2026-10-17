import PortMessage from '@/shared/utils/message/portMessage';
import {
  bgEventBus,
  isAllowedUiControllerMethod,
  isValidUiDevelopmentRequest,
  isValidUiMessageParams,
  preferenceService,
  providerController,
  sessionService,
  walletController
} from '@unisat/wallet-background';
import { BUS_EVENTS, MESSAGE_TYPE, PORT_CHANNELS } from '@unisat/wallet-shared';
import browser, { browserRuntimeOnConnect } from '../webapi/browser';
export function initMessaging() {
  // for page provider
  browserRuntimeOnConnect((port) => {
    const portName = port.name;

    const pm = new PortMessage(port as any);

    // UI ports — only accept connections from this extension
    if (['popup', 'notification', 'tab', 'sidepanel'].includes(portName)) {
      const selfId = browser.runtime?.id;
      if (!selfId || port.sender?.id !== selfId) {
        port.disconnect();
        return;
      }

      // listen the message from UI
      pm.listen((data) => {
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
          throw new Error('Invalid UI message');
        }
        switch (data.type) {
          case MESSAGE_TYPE.UI_BROADCAST:
            throw new Error('UI broadcasts are not allowed');
          case MESSAGE_TYPE.UI_REQUEST_METHOD:
            if (process.env.NODE_ENV === 'development') {
              if (!isValidUiDevelopmentRequest(data.params)) {
                throw new Error('Invalid UI development request');
              }
              return providerController.handleRequest(data.params);
            } else {
              throw new Error('UI_REQUEST_METHOD is only available in development mode');
            }
          case MESSAGE_TYPE.UI_OPENAPI:
            throw new Error('UI OpenAPI calls are not allowed');
          case MESSAGE_TYPE.UI_CONTROLLER:
            if (
              !isAllowedUiControllerMethod(data.method) ||
              !isValidUiMessageParams(data.params)
            ) {
              throw new Error('Invalid UI controller request');
            }
            return walletController[data.method](...data.params);
          default:
            throw new Error('Unsupported UI message type');
        }
      });

      // push the message to UI
      const broadcastToUI = (data: any) => {
        pm.request({
          type: MESSAGE_TYPE.BG_BROADCAST,
          method: data.method,
          params: data.params
        });
      };

      bgEventBus.addEventListener(BUS_EVENTS.broadcastToUI, broadcastToUI);

      port.onDisconnect.addListener(() => {
        bgEventBus.removeEventListener(BUS_EVENTS.broadcastToUI, broadcastToUI);
        if (portName === PORT_CHANNELS.POPUP) {
          preferenceService.setPopupOpen(false);
        }
      });

      if (portName === PORT_CHANNELS.POPUP) {
        preferenceService.setPopupOpen(true);
      }

      return;
    } else {
      // page provider port
      pm.listen(async (data) => {
        const sessionId = port.sender?.tab?.id;
        const session = sessionService.getOrCreateSession(sessionId) as any;

        const req = { data, session, port };
        // for background push to respective page
        req.session.pushMessage = (event, data) => {
          // Send a message to the page( SESSION_EVENTS)
          // example:  sessionService.broadcastEvent(SESSION_EVENTS.unlock)
          pm.send(MESSAGE_TYPE.PM_BG_TO_CONTENT, { event, data });
        };

        // handle the request
        return providerController.handleRequest(req);
      });

      port.onDisconnect.addListener(() => {
        // Clean up session if needed
        const sessionId = port.sender?.tab?.id;
        if (sessionId) {
          // Consider session cleanup here if needed
        }
      });
    }
  });
}
