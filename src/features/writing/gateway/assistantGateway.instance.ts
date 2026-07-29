import { getTelegramController } from '@app/telegram/telegramStore';
import { HttpAssistantGateway, type AssistantGateway } from './assistant.gateway';

/**
 * The app's single gateway.
 *
 * `VITE_ASSISTANT_ENDPOINT` is a URL, not a secret — it is the address of
 * SYO's own backend. The provider key lives there and only there; nothing in
 * this bundle could authenticate to a model provider even if it tried.
 */

const endpoint = import.meta.env.VITE_ASSISTANT_ENDPOINT ?? '/api/assistant';

let gateway: AssistantGateway = new HttpAssistantGateway({
  endpoint,
  initData: () => getTelegramController().getInitData(),
});

export const assistantGateway = (): AssistantGateway => gateway;

/** Test seam. */
export const setAssistantGateway = (next: AssistantGateway): void => {
  gateway = next;
};

/** False in a plain browser with no backend configured — AI is then hidden. */
export const assistantConfigured = (): boolean => Boolean(endpoint);
