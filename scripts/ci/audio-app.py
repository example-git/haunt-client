import ctypes
import math
import os
import struct
import sys
import threading


class SampleSpec(ctypes.Structure):
    _fields_ = [("format", ctypes.c_int), ("rate", ctypes.c_uint32), ("channels", ctypes.c_uint8)]


pulse = ctypes.CDLL("libpulse-simple.so.0")
pulse.pa_simple_new.restype = ctypes.c_void_p
pulse.pa_simple_new.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(SampleSpec), ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
pulse.pa_simple_write.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_int)]
pulse.pa_simple_free.argtypes = [ctypes.c_void_p]
streams = {}
display = None
if "--window" in sys.argv:
    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XCreateSimpleWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_ulong]
    x11.XCreateSimpleWindow.restype = ctypes.c_ulong
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XChangeProperty.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    x11.XStoreName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_char_p]
    x11.XMapWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XSetWindowBackground.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong]
    x11.XClearWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("X11 fixture display is unavailable")
    window = x11.XCreateSimpleWindow(display, x11.XDefaultRootWindow(display), 10, 10, 640, 360, 0, 0, 0xE02040)
    pid = ctypes.c_ulong(os.getpid())
    x11.XChangeProperty(display, window, x11.XInternAtom(display, b"_NET_WM_PID", 0), 6, 32, 0, ctypes.byref(pid), 1)
    x11.XStoreName(display, window, sys.argv[1].encode())
    x11.XMapWindow(display, window)
    x11.XFlush(display)


def tone(frequency, stopped):
    error = ctypes.c_int()
    spec = SampleSpec(5, 48000, 2)
    stream = pulse.pa_simple_new(None, sys.argv[1].encode(), 1, None, f"{frequency} Hz".encode(), ctypes.byref(spec), None, None, ctypes.byref(error))
    if not stream:
        raise RuntimeError(f"PulseAudio connection failed: {error.value}")
    position = 0
    print(f"ready {frequency}", flush=True)
    try:
        while not stopped.is_set():
            data = b"".join(struct.pack("<ff", *([0.15 * math.sin(2 * math.pi * frequency * (position + i) / 48000)] * 2)) for i in range(960))
            position += 960
            if pulse.pa_simple_write(stream, data, len(data), ctypes.byref(error)) < 0:
                raise RuntimeError(f"PulseAudio playback failed: {error.value}")
    finally:
        pulse.pa_simple_free(stream)


try:
    for line in sys.stdin:
        command, frequency = line.split()
        if command == "color" and display:
            x11.XSetWindowBackground(display, window, int(frequency, 16))
            x11.XClearWindow(display, window)
            x11.XFlush(display)
            continue
        frequency = int(frequency)
        if command == "add":
            stopped = threading.Event()
            thread = threading.Thread(target=tone, args=(frequency, stopped), daemon=True)
            streams[frequency] = (stopped, thread)
            thread.start()
        elif command == "remove":
            stopped, thread = streams.pop(frequency)
            stopped.set()
            thread.join(timeout=5)
        else:
            raise ValueError(command)
finally:
    for stopped, thread in streams.values():
        stopped.set()
    for stopped, thread in streams.values():
        thread.join(timeout=5)
    if display:
        x11.XCloseDisplay(display)
