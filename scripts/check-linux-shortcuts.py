import json
import os
import subprocess
import sys
import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName("org.freedesktop.portal.Desktop", bus)
loop = GLib.MainLoop()
session_path = "/org/freedesktop/portal/desktop/session/fixture/haunt"


class Request(dbus.service.Object):
    @dbus.service.signal("org.freedesktop.portal.Request", signature="ua{sv}")
    def Response(self, code, values):
        pass


class Session(dbus.service.Object):
    @dbus.service.signal("org.freedesktop.portal.Session", signature="")
    def Closed(self):
        pass

    @dbus.service.method("org.freedesktop.portal.Session", in_signature="", out_signature="")
    def Close(self):
        pass


session = Session(bus, session_path)
requests = []


class Portal(dbus.service.Object):
    @dbus.service.method("org.freedesktop.portal.GlobalShortcuts", in_signature="a{sv}", out_signature="o")
    def CreateSession(self, options):
        assert str(options["session_handle_token"]).startswith("haunt_ptt_")
        path = "/org/freedesktop/portal/desktop/request/fixture/create"
        request = Request(bus, path)
        requests.append(request)
        GLib.timeout_add(20, lambda: request.Response(0, {"session_handle": dbus.String(session_path)}))
        return path

    @dbus.service.method("org.freedesktop.portal.GlobalShortcuts", in_signature="oa(sa{sv})sa{sv}", out_signature="o")
    def BindShortcuts(self, handle, shortcuts, parent, options):
        assert str(handle) == session_path
        assert len(shortcuts) == 1 and str(shortcuts[0][0]) == "ptt"
        assert str(shortcuts[0][1]["preferred_trigger"]) == "F9"
        path = "/org/freedesktop/portal/desktop/request/fixture/bind"
        request = Request(bus, path)
        requests.append(request)
        values = dbus.Array([dbus.Struct(("ptt", dbus.Dictionary({"trigger_description": "F9 fixture"}, signature="sv")))], signature="(sa{sv})")
        GLib.timeout_add(20, lambda: request.Response(0, {"shortcuts": values}))
        GLib.timeout_add(100, lambda: self.Activated(session_path, "ptt", 1, {}))
        GLib.timeout_add(200, lambda: self.Deactivated(session_path, "ptt", 2, {}))
        GLib.timeout_add(300, session.Closed)
        return path

    @dbus.service.signal("org.freedesktop.portal.GlobalShortcuts", signature="osta{sv}")
    def Activated(self, session, shortcut, timestamp, options):
        pass

    @dbus.service.signal("org.freedesktop.portal.GlobalShortcuts", signature="osta{sv}")
    def Deactivated(self, session, shortcut, timestamp, options):
        pass


portal = Portal(bus, "/org/freedesktop/portal/desktop")
child = subprocess.Popen([sys.argv[1]], env={**os.environ, "XDG_SESSION_TYPE": "wayland"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
timed_out = False


def poll():
    if child.poll() is not None:
        loop.quit()
        return False
    return True


def timeout():
    global timed_out
    timed_out = True
    child.kill()
    loop.quit()
    return False


GLib.timeout_add(20, poll)
GLib.timeout_add_seconds(10, timeout)
try:
    loop.run()
    stdout, stderr = child.communicate(timeout=2)
    assert not timed_out, stderr
    assert [json.loads(line) for line in stdout.splitlines()] == [{"ready": True, "trigger": "F9 fixture"}, {"pressed": True}, {"pressed": False}], (stdout, stderr)
    assert child.returncode == 1 and "closed the push-to-talk" in stderr, stderr
    print("PASS Wayland portal protocol fixture: session, binding, held-key transitions and closed-session failure; no native compositor claim.")
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
