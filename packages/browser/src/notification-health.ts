let deliveryError = "";
const healthListeners = new Set<() => void>();
export const notificationError = () => deliveryError;
export const subscribeNotificationHealth = (listener: () => void) => {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
};
export function reportNotificationError(message: string) {
  deliveryError = message;
  healthListeners.forEach((listener) => listener());
}
