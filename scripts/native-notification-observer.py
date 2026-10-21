"""Observe the real desktop bus; never own or implement notification services."""
import json
import sys
from pathlib import Path

import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
log = Path(sys.argv[1])


def record(value):
    with log.open("a") as stream:
        stream.write(json.dumps(value) + "\n")


bus = dbus.SessionBus()
service = dbus.Interface(bus.get_object("org.freedesktop.Notifications", "/org/freedesktop/Notifications"), "org.freedesktop.Notifications")
server = list(service.GetServerInformation())
record({"kind": "server", "identity": [str(value) for value in server]})


def received(_connection, message):
    interface, member = message.get_interface(), message.get_member()
    if interface == "org.freedesktop.Notifications" and member == "Notify":
        app, replaces, icon, title, body, actions, hints, expires = message.get_args_list()
        record({"kind": "notification", "app": str(app), "title": str(title), "body": str(body), "actions": list(actions),
                "desktopEntry": str(hints.get("desktop-entry", "")), "transient": bool(hints.get("transient", False)), "expires": int(expires)})
    elif interface == "com.canonical.Unity.LauncherEntry" and member == "Update":
        application, properties = message.get_args_list()
        record({"kind": "badge", "application": str(application), "count": int(properties.get("count", 0)), "visible": bool(properties.get("count-visible", False))})
    elif interface == "org.freedesktop.Notifications" and member == "ActionInvoked":
        identifier, action = message.get_args_list()
        record({"kind": "activate", "id": int(identifier), "action": str(action)})


bus.add_message_filter(received)
bus.call_blocking("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.Monitoring", "BecomeMonitor", "asu", (
    ["interface='org.freedesktop.Notifications'", "interface='com.canonical.Unity.LauncherEntry'"], 0))
record({"kind": "ready"})
GLib.MainLoop().run()
