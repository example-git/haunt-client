#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

// Keep Electron's notification objects, response dispatch and OS preferences.
// The combined alert option asks macOS to apply the user's banner/alert style
// and retain the notification, without separately inserting a list entry before
// presenting it. That ordering suppresses foreground banners on macOS 14.
@interface HauntNotificationPresentation : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, strong) id<UNUserNotificationCenterDelegate> downstream;
@end

@implementation HauntNotificationPresentation
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
  completion(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound);
}
- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || [self.downstream respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector {
  return [self.downstream respondsToSelector:selector] ? self.downstream : [super forwardingTargetForSelector:selector];
}
@end

static HauntNotificationPresentation *presentation;

static napi_value Install(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    if (![NSThread isMainThread]) {
      napi_throw_error(env, NULL, "Notification presentation must be configured on the main thread");
      return NULL;
    }
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    id<UNUserNotificationCenterDelegate> delegate = center.delegate;
    if (!delegate) {
      napi_throw_error(env, NULL, "Electron's native notification delegate is unavailable");
      return NULL;
    }
    if (delegate != presentation) {
      presentation = [HauntNotificationPresentation new];
      presentation.downstream = delegate;
      center.delegate = presentation;
    }
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
  }
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"install", NULL, Install, NULL, NULL, NULL, napi_default, NULL}
  };
  napi_define_properties(env, exports, 1, methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
