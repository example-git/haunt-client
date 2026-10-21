#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <dispatch/dispatch.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  napi_deferred deferred;
  char *error;
  bool submitted;
} ReplacementResult;

static NSMutableDictionary<NSString *, NSNumber *> *pending;
static unsigned long long generation;

static void Complete(napi_env env, napi_value callback, void *context, void *data) {
  ReplacementResult *result = data;
  if (env) {
    napi_value value;
    if (result->error) {
      napi_value message;
      napi_create_string_utf8(env, result->error, NAPI_AUTO_LENGTH, &message);
      napi_create_error(env, NULL, message, &value);
      napi_reject_deferred(env, result->deferred, value);
    } else {
      napi_get_boolean(env, result->submitted, &value);
      napi_resolve_deferred(env, result->deferred, value);
    }
  }
  free(result->error);
  free(result);
}

static NSString *ReadString(napi_env env, napi_value value, size_t limit) {
  size_t size;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &size) != napi_ok || size > limit) {
    napi_throw_type_error(env, NULL, "Invalid native notification text");
    return nil;
  }
  char *buffer = malloc(size + 1);
  if (!buffer) {
    napi_throw_error(env, NULL, "Cannot allocate native notification text");
    return nil;
  }
  napi_get_value_string_utf8(env, value, buffer, size + 1, &size);
  NSString *text = [[NSString alloc] initWithBytes:buffer length:size encoding:NSUTF8StringEncoding];
  free(buffer);
  if (!text) napi_throw_type_error(env, NULL, "Invalid native notification encoding");
  return text;
}

static void Reply(napi_threadsafe_function reply, ReplacementResult *result) {
  if (napi_call_threadsafe_function(reply, result, napi_tsfn_nonblocking) != napi_ok) {
    free(result->error);
    free(result);
  }
  napi_release_threadsafe_function(reply, napi_tsfn_release);
}

// Keep Electron's identifier and click dispatch. Both immediate replacement and
// close-then-show race Notification Center's list refresh on macOS 14. Separate
// removal and delivery on the native queue. A newer request or explicit close
// cancels the pending delivery rather than resurrecting an obsolete popup.
static napi_value Replace(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    if (count != 3) {
      napi_throw_type_error(env, NULL, "Notification replacement requires identifier, title and body");
      return NULL;
    }
    NSString *identifier = ReadString(env, args[0], 1024);
    if (!identifier) return NULL;
    NSString *title = ReadString(env, args[1], 960);
    if (!title) return NULL;
    NSString *body = ReadString(env, args[2], 1600);
    if (!body) return NULL;
    if (!identifier.length || !title.length) {
      napi_throw_type_error(env, NULL, "Notification identifier and title cannot be empty");
      return NULL;
    }
    ReplacementResult *result = calloc(1, sizeof(ReplacementResult));
    if (!result) {
      napi_throw_error(env, NULL, "Cannot allocate native notification result");
      return NULL;
    }
    napi_value promise, name;
    napi_create_string_utf8(env, "Haunt notification replacement", NAPI_AUTO_LENGTH, &name);
    napi_threadsafe_function reply;
    if (napi_create_threadsafe_function(env, NULL, NULL, name, 1, 1, NULL, NULL, NULL, Complete, &reply) != napi_ok) {
      free(result);
      napi_throw_error(env, NULL, "Cannot receive native notification completion");
      return NULL;
    }
    napi_create_promise(env, &result->deferred, &promise);
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = title;
    content.body = body;
    content.sound = nil;
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
    if (!pending) pending = [NSMutableDictionary new];
    NSNumber *token = @(++generation);
    pending[identifier] = token;
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center removeDeliveredNotificationsWithIdentifiers:@[identifier]];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      if (![pending[identifier] isEqual:token]) {
        Reply(reply, result);
        return;
      }
      [pending removeObjectForKey:identifier];
      [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
        if (error) result->error = strdup(error.localizedDescription.UTF8String);
        result->submitted = error == nil;
        Reply(reply, result);
      }];
    });
    return promise;
  }
}

static napi_value Cancel(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1;
    napi_value arg, result;
    napi_get_cb_info(env, info, &count, &arg, NULL, NULL);
    if (count != 1) {
      napi_throw_type_error(env, NULL, "Notification cancellation requires an identifier");
      return NULL;
    }
    NSString *identifier = ReadString(env, arg, 1024);
    if (!identifier) return NULL;
    [pending removeObjectForKey:identifier];
    napi_get_undefined(env, &result);
    return result;
  }
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"replace", NULL, Replace, NULL, NULL, NULL, napi_default, NULL},
    {"cancel", NULL, Cancel, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
