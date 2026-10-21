import { shouldNotify, type InstanceClient } from "@haunt/core";
import { getPreferences } from "./preferences";
import { deliverPing } from "./notifications";
import { reportNotificationError } from "./notification-health";
import { currentBadgeResult } from "./badges";
import {
  beginNotificationTest,
  clearNotificationTest,
  notificationTestInstance,
  notificationTestConversation,
} from "./notification-test-state";

/** A local sample uses production policy, delivery and unread badge subscribers. */
export async function testNotification(instance?: InstanceClient) {
  reportNotificationError("");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  beginNotificationTest();
  const prefs = getPreferences();
  const allowed = shouldNotify(prefs, {
    own: false,
    direct: true,
    mentioned: false,
    viewing: false,
    serverRule:
      instance && prefs.servers[instance.account.instance.instance_id],
  });
  const popup = allowed
    ? await deliverPing(
        {
          id: notificationTestConversation,
          scope: notificationTestInstance,
          instance:
            instance?.account.instance.instance_id ?? notificationTestInstance,
          conversation: notificationTestConversation,
          direct: true,
          title: "Haunt notification test",
          body: "This is a local test message. Click to clear its unread badge.",
          at: Date.now(),
        },
        clearNotificationTest,
      )
    : "Message notification rules suppressed the test popup and sound.";
  return `${popup} ${await currentBadgeResult()} The test adds one unread item for one minute; clearing it preserves your real unread counts.`;
}
