import { enforceCasePolicies, workDelivery } from "./worker";

export const usesInlineWorker = () => process.env.TRACEPREDICT_WORKER_MODE === "inline";

export async function processInlineDelivery(deliveryId: string) {
  if (!usesInlineWorker()) return;
  try {
    await workDelivery(deliveryId);
  } catch (error) {
    // The accepted delivery remains durable and can be retried on the next request.
    console.error("Request-triggered delivery processing failed", (error as Error).message);
  }
}

let lastCheck = 0;

export async function maintainInlineQueue() {
  if (!usesInlineWorker() || Date.now() - lastCheck < 30_000) return;
  lastCheck = Date.now();
  try {
    for (let count = 0; count < 3; count++) {
      if (!await workDelivery()) break;
    }
    await enforceCasePolicies();
  } catch (error) {
    console.error("Request-triggered case maintenance failed", (error as Error).message);
  }
}
