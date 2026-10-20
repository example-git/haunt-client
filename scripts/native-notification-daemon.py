"""Disposable CI notification daemon; records real Electron D-Bus traffic."""
import json
import sys
from pathlib import Path

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
log = Path(sys.argv[1])


def record(value):
    with log.open("a") as stream:
        stream.write(json.dumps(value) + "\n")


bus = dbus.SessionBus()
unity = dbus.service.BusName("com.canonical.Unity", bus)
name = dbus.service.BusName("org.freedesktop.Notifications", bus)


class Notifications(dbus.service.Object):
    count = 0

    @dbus.service.method("org.freedesktop.Notifications", in_signature="", out_signature="as")
    def GetCapabilities(self):
        return ["body", "actions", "persistence"]

    @dbus.service.method("org.freedesktop.Notifications", in_signature="", out_signature="ssss")
    def GetServerInformation(self):
        return "Haunt isolated CI daemon", "Haunt", "1.0", "1.2"

    @dbus.service.method("org.freedesktop.Notifications", in_signature="susssasa{sv}i", out_signature="u")
    def Notify(self, app, replaces, icon, title, body, actions, hints, expires):
        self.count += 1
        record({"kind": "notification", "id": self.count, "app": str(app), "title": str(title), "body": str(body), "actions": list(actions)})
        return self.count

    @dbus.service.method("org.freedesktop.Notifications", in_signature="u", out_signature="")
    def CloseNotification(self, identifier):
        record({"kind": "close", "id": int(identifier)})
        self.NotificationClosed(identifier, 3)

    @dbus.service.signal("org.freedesktop.Notifications", signature="uu")
    def NotificationClosed(self, identifier, reason):
        pass

    @dbus.service.signal("org.freedesktop.Notifications", signature="us")
    def ActionInvoked(self, identifier, action):
        pass

    @dbus.service.method("vg.xo.haunt.Test", in_signature="u", out_signature="")
    def Activate(self, identifier):
        self.ActionInvoked(identifier, "default")


service = Notifications(bus, "/org/freedesktop/Notifications")


def badge(application, properties):
    record({"kind": "badge", "application": str(application),
            "count": int(properties.get("count", 0)),
            "visible": bool(properties.get("count-visible", False))})


bus.add_signal_receiver(badge, signal_name="Update", dbus_interface="com.canonical.Unity.LauncherEntry")
record({"kind": "ready"})
GLib.MainLoop().run()
