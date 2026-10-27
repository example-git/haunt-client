#include <gio/gio.h>
#include <X11/Xlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static GMainLoop *loop;
static GDBusConnection *bus;
static char *session_path, *request_path;
static const char *portal = "org.freedesktop.portal.Desktop";
static const char *object = "/org/freedesktop/portal/desktop";
static const char *interface = "org.freedesktop.portal.GlobalShortcuts";
static int binding, result = 1;

static void output(const char *text) { puts(text); fflush(stdout); }
static void fail(const char *message) { fprintf(stderr, "%s\n", message); g_main_loop_quit(loop); }
static void ready(const char *trigger) {
  fputs("{\"ready\":true,\"trigger\":\"", stdout);
  for (const unsigned char *p = (const unsigned char *)trigger; *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  output("\"}");
}
static void request(const char *method, GVariant *parameters) {
  GError *error = NULL;
  GVariant *response = g_dbus_connection_call_sync(bus, portal, object, interface, method, parameters, G_VARIANT_TYPE("(o)"), G_DBUS_CALL_FLAGS_NONE, 10000, NULL, &error);
  if (!response) { fail(error->message); g_error_free(error); return; }
  const char *handle;
  g_variant_get(response, "(&o)", &handle);
  g_free(request_path); request_path = g_strdup(handle);
  g_variant_unref(response);
}
static void response_signal(GDBusConnection *connection, const gchar *sender, const gchar *path, const gchar *iface, const gchar *signal, GVariant *parameters, gpointer userdata) {
  (void)connection; (void)sender; (void)iface; (void)signal; (void)userdata;
  if (!request_path || strcmp(path, request_path) != 0) return;
  guint32 code;
  GVariant *values;
  g_variant_get(parameters, "(u@a{sv})", &code, &values);
  if (code != 0) { g_variant_unref(values); fail("Global push-to-talk binding was not approved by the desktop."); return; }
  if (!binding) {
    const char *handle = NULL;
    if (!g_variant_lookup(values, "session_handle", "&s", &handle) || !g_variant_is_object_path(handle)) { g_variant_unref(values); fail("The shortcut portal returned no session."); return; }
    session_path = g_strdup(handle);
    GVariantBuilder shortcuts, properties, options;
    g_variant_builder_init(&shortcuts, G_VARIANT_TYPE("a(sa{sv})"));
    g_variant_builder_init(&properties, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&properties, "{sv}", "description", g_variant_new_string("Haunt push to talk"));
    g_variant_builder_add(&properties, "{sv}", "preferred_trigger", g_variant_new_string("F9"));
    g_variant_builder_add(&shortcuts, "(sa{sv})", "ptt", &properties);
    g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
    binding = 1;
    request("BindShortcuts", g_variant_new("(oa(sa{sv})sa{sv})", session_path, &shortcuts, "", &options));
  } else {
    GVariant *shortcuts = g_variant_lookup_value(values, "shortcuts", G_VARIANT_TYPE("a(sa{sv})"));
    gboolean found = FALSE;
    if (shortcuts) {
      GVariantIter iter; const char *id; GVariant *properties;
      g_variant_iter_init(&iter, shortcuts);
      while (g_variant_iter_next(&iter, "(&s@a{sv})", &id, &properties)) {
        if (strcmp(id, "ptt") == 0) {
          const char *trigger = NULL;
          if (g_variant_lookup(properties, "trigger_description", "&s", &trigger)) { ready(trigger); found = TRUE; }
        }
        g_variant_unref(properties);
      }
      g_variant_unref(shortcuts);
    }
    if (!found) fail("The desktop did not bind push to talk.");
  }
  g_variant_unref(values);
}
static void shortcut_signal(GDBusConnection *connection, const gchar *sender, const gchar *path, const gchar *iface, const gchar *signal, GVariant *parameters, gpointer userdata) {
  (void)connection; (void)sender; (void)path; (void)iface; (void)userdata;
  if (!session_path) return;
  if (strcmp(signal, "Activated") != 0 && strcmp(signal, "Deactivated") != 0) return;
  const char *session, *id; guint64 timestamp; GVariant *options;
  g_variant_get(parameters, "(&o&st@a{sv})", &session, &id, &timestamp, &options);
  if (strcmp(session, session_path) == 0 && strcmp(id, "ptt") == 0)
    output(strcmp(signal, "Activated") == 0 ? "{\"pressed\":true}" : "{\"pressed\":false}");
  g_variant_unref(options);
}
static void session_closed(GDBusConnection *connection, const gchar *sender, const gchar *path, const gchar *iface, const gchar *signal, GVariant *parameters, gpointer userdata) {
  (void)connection; (void)sender; (void)iface; (void)signal; (void)parameters; (void)userdata;
  if (session_path && strcmp(path, session_path) == 0) fail("The desktop closed the push-to-talk shortcut session.");
}
int main(void) {
  const char *type = getenv("XDG_SESSION_TYPE");
  const char *wayland = getenv("WAYLAND_DISPLAY");
  if ((!type || strcmp(type, "wayland") != 0) && (!wayland || !*wayland)) {
    Display *display = XOpenDisplay(NULL);
    if (!display) { fputs("Cannot connect to the X11 display.\n", stderr); return 1; }
    KeyCode key = XKeysymToKeycode(display, XStringToKeysym("F9"));
    if (!key) { XCloseDisplay(display); return 1; }
    int previous = 0;
    ready("F9");
    for (;;) {
      char keys[32];
      XQueryKeymap(display, keys);
      int pressed = (keys[key / 8] & (1 << (key % 8))) != 0;
      if (pressed != previous) { output(pressed ? "{\"pressed\":true}" : "{\"pressed\":false}"); previous = pressed; }
      usleep(10000);
    }
  }
  loop = g_main_loop_new(NULL, FALSE);
  GError *error = NULL;
  bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) { fprintf(stderr, "%s\n", error->message); g_error_free(error); g_main_loop_unref(loop); return 1; }
  g_dbus_connection_signal_subscribe(bus, portal, "org.freedesktop.portal.Request", "Response", NULL, NULL, G_DBUS_SIGNAL_FLAGS_NONE, response_signal, NULL, NULL);
  g_dbus_connection_signal_subscribe(bus, portal, interface, NULL, object, NULL, G_DBUS_SIGNAL_FLAGS_NONE, shortcut_signal, NULL, NULL);
  g_dbus_connection_signal_subscribe(bus, portal, "org.freedesktop.portal.Session", "Closed", NULL, NULL, G_DBUS_SIGNAL_FLAGS_NONE, session_closed, NULL, NULL);
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  char token[64]; snprintf(token, sizeof(token), "haunt_ptt_%d", getpid());
  g_variant_builder_add(&options, "{sv}", "session_handle_token", g_variant_new_string(token));
  request("CreateSession", g_variant_new("(a{sv})", &options));
  if (request_path) g_main_loop_run(loop);
  if (session_path) g_dbus_connection_call_sync(bus, portal, session_path, "org.freedesktop.portal.Session", "Close", NULL, NULL, G_DBUS_CALL_FLAGS_NONE, 2000, NULL, NULL);
  g_free(session_path); g_free(request_path); g_object_unref(bus); g_main_loop_unref(loop);
  return result;
}
