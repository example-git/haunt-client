#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <gst/app/gstappsink.h>
#include <gst/video/video.h>
#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <glib-unix.h>
#include <pulse/pulseaudio.h>
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/Xrandr.h>
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  uint32_t index, sink;
  pa_stream *stream;
  GstElement *source;
  GstPad *pad;
} Tap;

static GMainLoop *loop, *request_loop;
static GDBusConnection *bus;
static char *session;
static int remote_fd = -1, status;
static GstElement *video, *audio, *mixer;
static pa_mainloop *pulse_loop;
static pa_context *pulse;
static GHashTable *taps, *seen_apps;
static GString *outputs, *apps;
static char *default_sink, *audio_id;
static guint pulse_timer;
static int listing, pulse_done, pulse_ready, source_width, source_height;
static int output_width = 1920, output_height = 1080, fps = 60;
static unsigned long xid;
static int screen_x, screen_y, screen_width, screen_height;
static uint32_t node_id;
static long app_pid;
static guint64 app_start;
static gboolean video_configured, audio_configured, stopping;
static guint64 timestamp_origin, video_origin;
static GVariant *response;
static guint response_code;
static GMutex packet_lock;
static const char *video_encoder;
static Display *window_display;
static Pixmap window_pixmap;
static int window_width, window_height;
static guint window_timer;

static int xerror(Display *display, XErrorEvent *event);

static void fail(const char *message) {
  fprintf(stderr, "%s\n", message);
  status = 1;
  if (request_loop) g_main_loop_quit(request_loop);
  if (loop) g_main_loop_quit(loop);
}

static gboolean stop(gpointer unused) {
  (void)unused;
  stopping = TRUE;
  if (request_loop) g_main_loop_quit(request_loop);
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void quote(GString *out, const char *value) {
  g_string_append_c(out, '"');
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; p++) {
    if (*p == '"' || *p == '\\') g_string_append_printf(out, "\\%c", *p);
    else if (*p < 32) g_string_append_printf(out, "\\u%04x", *p);
    else g_string_append_c(out, *p);
  }
  g_string_append_c(out, '"');
}

static guint64 process_start(long pid, long *parent) {
  char path[64], *data = NULL;
  g_snprintf(path, sizeof(path), "/proc/%ld/stat", pid);
  if (pid <= 0 || !g_file_get_contents(path, &data, NULL, NULL)) return 0;
  char *end = strrchr(data, ')');
  guint64 result = 0;
  if (end && end[1] == ' ') {
    char **fields = g_strsplit(end + 2, " ", 0);
    if (g_strv_length(fields) > 19) {
      result = g_ascii_strtoull(fields[19], NULL, 10);
      if (parent) *parent = strtol(fields[1], NULL, 10);
    }
    g_strfreev(fields);
  }
  g_free(data);
  return result;
}

static gboolean belongs(long pid) {
  if (process_start(app_pid, NULL) != app_start) return FALSE;
  for (int depth = 0; pid > 1 && depth < 64; depth++) {
    if (pid == app_pid) return TRUE;
    long parent = 0;
    if (!process_start(pid, &parent) || parent == pid) return FALSE;
    pid = parent;
  }
  return FALSE;
}

static long application_process(long pid) {
  char path[64];
  g_snprintf(path, sizeof(path), "/proc/%ld/exe", pid);
  char *binary = g_file_read_link(path, NULL);
  if (!binary) return pid;
  for (int depth = 0; depth < 64; depth++) {
    long parent = 0;
    if (!process_start(pid, &parent) || parent <= 1 || parent == pid) break;
    g_snprintf(path, sizeof(path), "/proc/%ld/exe", parent);
    char *parent_binary = g_file_read_link(path, NULL);
    gboolean same = g_strcmp0(binary, parent_binary) == 0;
    g_free(parent_binary);
    if (!same) break;
    pid = parent;
  }
  g_free(binary); return pid;
}

static char *add_app(long pid, const char *name) {
  guint64 start = process_start(pid, NULL);
  if (!start) return NULL;
  char *id = g_strdup_printf("app:%ld:%" G_GUINT64_FORMAT, pid, start);
  if (!g_hash_table_contains(seen_apps, id)) {
    g_hash_table_add(seen_apps, g_strdup(id));
    if (apps->len) g_string_append_c(apps, ',');
    g_string_append(apps, "{\"id\":"); quote(apps, id);
    g_string_append(apps, ",\"label\":"); quote(apps, name);
    g_string_append_printf(apps, ",\"pid\":%ld,\"kind\":\"app\"}", pid);
  }
  return id;
}

static gboolean write_all(int fd, const void *bytes, size_t length) {
  const char *p = bytes;
  while (length) {
    ssize_t n = write(fd, p, length);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return FALSE;
    p += n; length -= (size_t)n;
  }
  return TRUE;
}

static gboolean packet(int fd, int type, gboolean key, guint64 timestamp, const void *data, size_t length) {
  if (length > 4 * 1024 * 1024) { fail("Capture packet exceeds limit"); return FALSE; }
  unsigned char header[24] = {'S', 'C', 'A', 'P', 1, (unsigned char)type, 0, key ? 1 : 0};
  guint64 pts = GUINT64_TO_BE(timestamp);
  guint32 size = GUINT32_TO_BE((guint32)length);
  memcpy(header + 8, &pts, 8); memcpy(header + 16, &size, 4);
  g_mutex_lock(&packet_lock);
  gboolean ok = write_all(fd, header, sizeof(header)) && write_all(fd, data, length);
  g_mutex_unlock(&packet_lock);
  if (!ok) fail("Capture pipe closed");
  return ok;
}

static GstFlowReturn sample(GstAppSink *sink, gpointer userdata) {
  int fd = GPOINTER_TO_INT(userdata);
  GstSample *s = gst_app_sink_pull_sample(sink);
  if (!s) return GST_FLOW_EOS;
  GstBuffer *buffer = gst_sample_get_buffer(s);
  GstMapInfo map;
  if (!gst_buffer_map(buffer, &map, GST_MAP_READ)) { gst_sample_unref(s); return GST_FLOW_ERROR; }
  if (fd == 3 && !video_configured) {
    const guint8 *sps = NULL; size_t size = 0;
    for (size_t i = 0; i + 4 < map.size; i++) {
      size_t prefix = !memcmp(map.data + i, "\0\0\0\1", 4) ? 4 : !memcmp(map.data + i, "\0\0\1", 3) ? 3 : 0;
      if (prefix && (map.data[i + prefix] & 31) == 7) {
        size_t end = i + prefix + 1;
        while (end + 3 < map.size && memcmp(map.data + end, "\0\0\1", 3) && memcmp(map.data + end, "\0\0\0\1", 4)) end++;
        if (end + 3 >= map.size) end = map.size;
        sps = map.data + i + prefix; size = end - i - prefix; break;
      }
    }
    if (sps && size >= 4) {
      GstStructure *caps = gst_caps_get_structure(gst_sample_get_caps(s), 0);
      int w = 0, h = 0;
      gst_structure_get_int(caps, "width", &w); gst_structure_get_int(caps, "height", &h);
      char *encoded = g_base64_encode(sps, size);
      char *config = g_strdup_printf("{\"codec\":\"h264\",\"format\":\"annexb\",\"width\":%d,\"height\":%d,\"fps\":%d,\"encoder\":\"%s\",\"parameterSets\":[\"%s\"]}", w, h, fps, video_encoder, encoded);
      packet(fd, 1, FALSE, 0, config, strlen(config));
      g_free(config); g_free(encoded); video_configured = TRUE;
    }
  }
  if (fd == 4 && !audio_configured) {
    const char *config = "{\"codec\":\"lpcm\",\"channels\":2,\"sampleRate\":48000,\"bitsPerChannel\":32,\"isInterleaved\":true,\"formatFlags\":1}";
    packet(fd, 1, FALSE, 0, config, strlen(config)); audio_configured = TRUE;
  }
  GstClockTime pts = gst_segment_to_running_time(gst_sample_get_segment(s), GST_FORMAT_TIME, GST_BUFFER_PTS(buffer));
  if ((fd == 4 || video_configured) && GST_CLOCK_TIME_IS_VALID(pts))
    packet(fd, 2, !GST_BUFFER_FLAG_IS_SET(buffer, GST_BUFFER_FLAG_DELTA_UNIT), (fd == 3 ? video_origin : timestamp_origin) + pts, map.data, map.size);
  gst_buffer_unmap(buffer, &map); gst_sample_unref(s);
  return status ? GST_FLOW_ERROR : GST_FLOW_OK;
}

static gboolean gst_message(GstBus *gst_bus, GstMessage *message, gpointer unused) {
  (void)gst_bus; (void)unused;
  if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
    GError *error = NULL; char *debug = NULL;
    gst_message_parse_error(message, &error, &debug);
    fail(error->message); g_error_free(error); g_free(debug);
  } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_EOS) fail("Capture source ended");
  return G_SOURCE_CONTINUE;
}

static gboolean play(GstElement *pipeline, int fd) {
  GstElement *sink = gst_bin_get_by_name(GST_BIN(pipeline), "capture");
  g_signal_connect(sink, "new-sample", G_CALLBACK(sample), GINT_TO_POINTER(fd));
  gst_object_unref(sink);
  GstBus *gst_bus = gst_element_get_bus(pipeline);
  gst_bus_add_watch(gst_bus, gst_message, NULL); gst_object_unref(gst_bus);
  if (gst_element_set_state(pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
    fail("Cannot start GStreamer capture"); return FALSE;
  }
  return TRUE;
}

static gboolean encoder_option(GstElement *encoder, const char *property, const char *value) {
  GParamSpec *spec = g_object_class_find_property(G_OBJECT_GET_CLASS(encoder), property);
  if (!spec || !(spec->flags & G_PARAM_WRITABLE)) return FALSE;
  if (G_IS_PARAM_SPEC_ENUM(spec)) {
    GEnumClass *values = g_type_class_ref(spec->value_type);
    gboolean supported = g_enum_get_value_by_nick(values, value) != NULL;
    g_type_class_unref(values);
    if (!supported) return FALSE;
  }
  gst_util_set_object_arg(G_OBJECT(encoder), property, value);
  return TRUE;
}

static void configure_encoder(GstElement *pipeline, const char *name, int w, int h) {
  GstElement *encoder = gst_bin_get_by_name(GST_BIN(pipeline), "encoder");
  gboolean v4l2 = g_str_equal(name, "nvv4l2h264enc");
  int bitrate = MAX(1000, (int)((double)w * h * fps * 0.07 / 1000));
  char *rate = g_strdup_printf("%d", v4l2 ? bitrate * 1000 : bitrate);
  char *interval = g_strdup_printf("%d", fps);
  encoder_option(encoder, "bitrate", rate);
  if (v4l2) {
    encoder_option(encoder, "iframeinterval", interval);
    encoder_option(encoder, "idrinterval", interval);
    if (!encoder_option(encoder, "profile", "Constrained-Baseline"))
      encoder_option(encoder, "profile", "Baseline");
    encoder_option(encoder, "control-rate", "constant_bitrate");
    encoder_option(encoder, "preset-id", "3");
    encoder_option(encoder, "tuning-info-id", "UltraLowLatencyPreset");
    encoder_option(encoder, "num-B-Frames", "0");
    encoder_option(encoder, "insert-sps-pps", "true");
  } else if (g_str_equal(name, "x264enc")) {
    encoder_option(encoder, "tune", "zerolatency");
    encoder_option(encoder, "speed-preset", "veryfast");
    encoder_option(encoder, "key-int-max", interval);
    encoder_option(encoder, "bframes", "0");
    encoder_option(encoder, "byte-stream", "true");
  } else {
    encoder_option(encoder, "gop-size", interval);
    if (!encoder_option(encoder, "preset", "p3"))
      encoder_option(encoder, "preset", "low-latency-hq");
    encoder_option(encoder, "tune", "ultra-low-latency");
    if (!encoder_option(encoder, "rc-mode", "cbr"))
      encoder_option(encoder, "rate-control", "cbr");
    if (!encoder_option(encoder, "bframes", "0")) encoder_option(encoder, "b-frames", "0");
    encoder_option(encoder, "rc-lookahead", "0");
    encoder_option(encoder, "cabac", "false");
    encoder_option(encoder, "zerolatency", "true");
    encoder_option(encoder, "zero-reorder-delay", "true");
    encoder_option(encoder, "repeat-sequence-header", "true");
  }
  g_free(rate); g_free(interval); gst_object_unref(encoder);
}

static char *encoder_chain(const char *name) {
  const char *upload = "";
  if (g_str_equal(name, "nvv4l2h264enc")) {
    GstElementFactory *converter = gst_element_factory_find("nvvideoconvert");
    if (converter) { upload = "nvvideoconvert ! video/x-raw(memory:NVMM),format=NV12 ! "; gst_object_unref(converter); }
    else {
      converter = gst_element_factory_find("nvvidconv");
      if (!converter) return NULL;
      gst_object_unref(converter); upload = "nvvidconv ! video/x-raw(memory:NVMM),format=NV12 ! ";
    }
  }
  return g_strdup_printf("%s%s name=encoder ! h264parse config-interval=-1 ! "
    "video/x-h264,profile=(string){constrained-baseline,baseline},stream-format=byte-stream,alignment=au ! "
    "appsink name=capture emit-signals=true sync=false max-buffers=3 drop=true", upload, name);
}

static gboolean probe_encoder(const char *name, int w, int h) {
  GstElementFactory *factory = gst_element_factory_find(name);
  if (!factory) return FALSE;
  gst_object_unref(factory);
  char *chain = encoder_chain(name);
  if (!chain) return FALSE;
  char *description = g_strdup_printf("appsrc name=probe format=time caps=\"video/x-raw,format=NV12,width=%d,height=%d,framerate=%d/1,pixel-aspect-ratio=1/1\" ! %s", w, h, fps, chain);
  GError *error = NULL;
  GstElement *pipeline = gst_parse_launch(description, &error);
  g_free(description); g_free(chain);
  gboolean valid = FALSE;
  if (!error && pipeline) {
    configure_encoder(pipeline, name, w, h);
    GstElement *src = gst_bin_get_by_name(GST_BIN(pipeline), "probe");
    GstElement *sink = gst_bin_get_by_name(GST_BIN(pipeline), "capture");
    if (gst_element_set_state(pipeline, GST_STATE_PLAYING) != GST_STATE_CHANGE_FAILURE) {
      size_t stride = GST_ROUND_UP_4(w), rows = GST_ROUND_UP_2(h);
      GstBuffer *buffer = gst_buffer_new_allocate(NULL, stride * rows * 3 / 2, NULL);
      gst_buffer_memset(buffer, 0, 16, stride * rows);
      gst_buffer_memset(buffer, stride * rows, 128, stride * rows / 2);
      GST_BUFFER_PTS(buffer) = 0; GST_BUFFER_DURATION(buffer) = GST_SECOND / fps;
      gst_app_src_push_buffer(GST_APP_SRC(src), buffer);
      gst_app_src_end_of_stream(GST_APP_SRC(src));
      GstSample *encoded = gst_app_sink_try_pull_sample(GST_APP_SINK(sink), 3 * GST_SECOND);
      valid = encoded && gst_buffer_get_size(gst_sample_get_buffer(encoded)) > 0;
      if (encoded) gst_sample_unref(encoded);
    }
    gst_object_unref(src); gst_object_unref(sink);
    if (!valid) {
      GstBus *messages = gst_element_get_bus(pipeline);
      GstMessage *message = gst_bus_pop_filtered(messages, GST_MESSAGE_ERROR);
      if (message) { gst_message_parse_error(message, &error, NULL); gst_message_unref(message); }
      gst_object_unref(messages);
    }
  }
  if (!valid) fprintf(stderr, "Encoder %s unavailable: %s\n", name, error ? error->message : "no encoded frame");
  g_clear_error(&error);
  if (pipeline) { gst_element_set_state(pipeline, GST_STATE_NULL); gst_object_unref(pipeline); }
  return valid;
}

static void load_nvidia_plugins(void) {
  const char *directories[] = {
    "/opt/nvidia/deepstream/deepstream/lib/gst-plugins",
    "/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
    "/usr/lib/x86_64-linux-gnu/gstreamer-1.0", NULL
  };
  const char *files[] = {"libgstnvvideo4linux2.so", "libgstnvvideoconvert.so", "libgstnvvidconv.so", NULL};
  for (int i = 0; directories[i]; i++)
    for (int j = 0; files[j]; j++) {
      char *path = g_build_filename(directories[i], files[j], NULL);
      if (g_file_test(path, G_FILE_TEST_IS_REGULAR)) {
        GError *error = NULL;
        GstPlugin *plugin = gst_plugin_load_file(path, &error);
        if (plugin) gst_object_unref(plugin);
        else fprintf(stderr, "NVIDIA plugin %s unavailable: %s\n", path, error ? error->message : "load failed");
        g_clear_error(&error);
      }
      g_free(path);
    }
}

static void free_window_image(gpointer data) { XDestroyImage((XImage *)data); }

static gboolean window_frame(gpointer unused) {
  (void)unused;
  XWindowAttributes attributes;
  if (!XGetWindowAttributes(window_display, xid, &attributes) || attributes.map_state != IsViewable) {
    fail("Selected window is no longer visible"); return G_SOURCE_CONTINUE;
  }
  if (attributes.width < 2 || attributes.height < 2 || attributes.width > 16384 || attributes.height > 16384) {
    fail("Selected window has an unsupported size"); return G_SOURCE_CONTINUE;
  }
  if (!window_pixmap || window_width != attributes.width || window_height != attributes.height) {
    if (window_pixmap) XFreePixmap(window_display, window_pixmap);
    window_pixmap = XCompositeNameWindowPixmap(window_display, xid);
    window_width = attributes.width; window_height = attributes.height;
  }
  XImage *image = XGetImage(window_display, window_pixmap, 0, 0, window_width, window_height, AllPlanes, ZPixmap);
  if (!image) { fail("Cannot read the selected window image"); return G_SOURCE_CONTINUE; }
  GstVideoFormat format = gst_video_format_from_masks(image->depth, image->bits_per_pixel,
    image->byte_order == LSBFirst ? G_LITTLE_ENDIAN : G_BIG_ENDIAN,
    attributes.visual->red_mask, attributes.visual->green_mask, attributes.visual->blue_mask, 0);
  if (format == GST_VIDEO_FORMAT_UNKNOWN) { XDestroyImage(image); fail("Unsupported X11 window pixel format"); return G_SOURCE_CONTINUE; }
  GstElement *source = gst_bin_get_by_name(GST_BIN(video), "source");
  GstCaps *caps = gst_caps_new_simple("video/x-raw", "format", G_TYPE_STRING, gst_video_format_to_string(format),
    "width", G_TYPE_INT, window_width, "height", G_TYPE_INT, window_height,
    "framerate", GST_TYPE_FRACTION, fps, 1, "pixel-aspect-ratio", GST_TYPE_FRACTION, 1, 1, NULL);
  gst_app_src_set_caps(GST_APP_SRC(source), caps); gst_caps_unref(caps);
  size_t length = (size_t)image->bytes_per_line * image->height;
  GstBuffer *buffer = gst_buffer_new_wrapped_full(0, image->data, length, 0, length, image, free_window_image);
  gsize offsets[GST_VIDEO_MAX_PLANES] = {0};
  gint strides[GST_VIDEO_MAX_PLANES] = {image->bytes_per_line};
  gst_buffer_add_video_meta_full(buffer, GST_VIDEO_FRAME_FLAG_NONE, format, window_width, window_height, 1, offsets, strides);
  GST_BUFFER_DURATION(buffer) = GST_SECOND / fps;
  if (gst_app_src_push_buffer(GST_APP_SRC(source), buffer) != GST_FLOW_OK && !stopping)
    fail("Selected window capture stopped");
  gst_object_unref(source);
  return G_SOURCE_CONTINUE;
}

static gboolean open_window(void) {
  window_display = XOpenDisplay(NULL);
  if (!window_display) { fail("X11 display is unavailable"); return FALSE; }
  XSetErrorHandler(xerror);
  int event, error;
  if (!XCompositeQueryExtension(window_display, &event, &error)) { fail("XComposite is required for window capture"); return FALSE; }
  XCompositeRedirectWindow(window_display, xid, CompositeRedirectAutomatic);
  XSync(window_display, False);
  return TRUE;
}

static gboolean make_video(void) {
  double scale = MIN(1.0, MIN((double)output_width / source_width, (double)output_height / source_height));
  int w = MAX(2, ((int)(source_width * scale) / 2) * 2);
  int h = MAX(2, ((int)(source_height * scale) / 2) * 2);
  const char *candidates[] = {"nvcudah264enc", "nvh264enc", "nvv4l2h264enc", NULL};
  video_encoder = "x264enc";
  for (int i = 0; candidates[i]; i++)
    if (probe_encoder(candidates[i], w, h)) { video_encoder = candidates[i]; break; }
  fprintf(stderr, "Capture encoder: %s (%dx%d at %d fps)\n", video_encoder, w, h, fps);
  char *chain = encoder_chain(video_encoder);
  char *description = g_strdup_printf(
    "%s name=source ! queue max-size-buffers=3 max-size-bytes=0 max-size-time=0 leaky=downstream ! "
    "videorate ! video/x-raw,framerate=%d/1 ! videoconvert ! videoscale ! video/x-raw,format=NV12,width=%d,height=%d,pixel-aspect-ratio=1/1 ! %s",
    remote_fd >= 0 ? "pipewiresrc" : xid ? "appsrc" : "ximagesrc", fps, w, h, chain);
  g_free(chain);
  GError *error = NULL;
  video = gst_parse_launch(description, &error); g_free(description);
  if (error) { fail(error->message); g_error_free(error); return FALSE; }
  configure_encoder(video, video_encoder, w, h);
  GstElement *source = gst_bin_get_by_name(GST_BIN(video), "source");
  if (remote_fd >= 0) {
    char *node = g_strdup_printf("%u", node_id);
    g_object_set(source, "fd", remote_fd, "path", node, "do-timestamp", TRUE,
      "always-copy", TRUE, "keepalive-time", MAX(1, 1000 / fps), NULL); g_free(node);
  } else if (xid) g_object_set(source, "is-live", TRUE, "do-timestamp", TRUE, "format", GST_FORMAT_TIME, "max-buffers", (guint64)2, "leaky-type", 2, NULL);
  else g_object_set(source, "startx", screen_x, "starty", screen_y, "endx", screen_x + screen_width - 1, "endy", screen_y + screen_height - 1, "use-damage", FALSE, NULL);
  gst_object_unref(source); video_configured = FALSE;
  video_origin = (guint64)g_get_monotonic_time() * 1000;
  if (!play(video, 3)) return FALSE;
  if (xid) window_timer = g_timeout_add(MAX(1, 1000 / fps), window_frame, NULL);
  return TRUE;
}

static void tap_free(gpointer data) {
  Tap *tap = data;
  if (tap->stream) { pa_stream_disconnect(tap->stream); pa_stream_unref(tap->stream); }
  if (tap->source) {
    gst_element_set_state(tap->source, GST_STATE_NULL);
    GstPad *src = gst_element_get_static_pad(tap->source, "src");
    gst_pad_unlink(src, tap->pad); gst_object_unref(src);
    gst_element_release_request_pad(mixer, tap->pad); gst_object_unref(tap->pad);
    gst_bin_remove(GST_BIN(audio), tap->source);
  }
  g_free(tap);
}

static void read_audio(pa_stream *stream, size_t available, void *userdata) {
  (void)available;
  Tap *tap = userdata; const void *data; size_t bytes;
  if (pa_stream_peek(stream, &data, &bytes) < 0) { fail("Audio read failed"); return; }
  if (bytes) {
    if (bytes > 48000 * 8 / 2) { fail("Audio capture block exceeds limit"); return; }
    GstBuffer *buffer = gst_buffer_new_allocate(NULL, bytes, NULL);
    if (data) gst_buffer_fill(buffer, 0, data, bytes); else gst_buffer_memset(buffer, 0, 0, bytes);
    GST_BUFFER_DURATION(buffer) = gst_util_uint64_scale(bytes / 8, GST_SECOND, 48000);
    GstFlowReturn result = gst_app_src_push_buffer(GST_APP_SRC(tap->source), buffer);
    if (result != GST_FLOW_OK && !stopping) fail("Audio mixer stopped");
    pa_stream_drop(stream);
  }
}

static void failed_input(pa_context *context, const pa_sink_input_info *info, int end, void *userdata) {
  if (!g_hash_table_contains(taps, userdata)) return;
  if (info || (end < 0 && pa_context_errno(context) != PA_ERR_NOENTITY))
    fail("Selected application audio capture failed");
  else if (end) g_hash_table_remove(taps, userdata);
}

static void tap_state(pa_stream *stream, void *userdata) {
  Tap *tap = userdata;
  if (pa_stream_get_state(stream) == PA_STREAM_FAILED) {
    if (!app_pid) fail("Selected output capture failed");
    else {
      pa_operation *operation = pa_context_get_sink_input_info(pulse, tap->index, failed_input, GUINT_TO_POINTER(tap->index));
      if (operation) pa_operation_unref(operation);
      else fail("Selected application audio capture failed");
    }
  }
}

static void add_tap(uint32_t index, uint32_t sink, const char *monitor) {
  Tap *old = g_hash_table_lookup(taps, GUINT_TO_POINTER(index));
  if (old && old->sink == sink) return;
  if (old) g_hash_table_remove(taps, GUINT_TO_POINTER(index));
  Tap *tap = g_new0(Tap, 1); tap->index = index; tap->sink = sink;
  tap->source = gst_element_factory_make("appsrc", NULL);
  GstCaps *caps = gst_caps_from_string("audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved");
  g_object_set(tap->source, "caps", caps, "format", GST_FORMAT_TIME, "is-live", TRUE, "do-timestamp", TRUE,
    "min-latency", (gint64)0, "max-latency", (gint64)(GST_SECOND / 4),
    "max-bytes", (guint64)(48000 * 8 / 4), "leaky-type", 2, NULL);
  gst_caps_unref(caps); gst_bin_add(GST_BIN(audio), tap->source);
  tap->pad = gst_element_request_pad_simple(mixer, "sink_%u");
  GstPad *src = gst_element_get_static_pad(tap->source, "src");
  GstPadLinkReturn linked = gst_pad_link(src, tap->pad); gst_object_unref(src);
  if (linked != GST_PAD_LINK_OK) { tap_free(tap); fail("Cannot connect application audio"); return; }
  gst_element_sync_state_with_parent(tap->source);
  pa_sample_spec spec = {PA_SAMPLE_FLOAT32LE, 48000, 2};
  pa_channel_map channels; pa_channel_map_init_stereo(&channels);
  tap->stream = pa_stream_new(pulse, "Haunt shared audio", &spec, &channels);
  g_hash_table_insert(taps, GUINT_TO_POINTER(index), tap);
  pa_stream_set_read_callback(tap->stream, read_audio, tap);
  pa_stream_set_state_callback(tap->stream, tap_state, tap);
  if (app_pid && pa_stream_set_monitor_stream(tap->stream, index) < 0) { fail("Cannot isolate selected application audio"); return; }
  pa_buffer_attr buffer = {.maxlength=48000*8/4, .tlength=(uint32_t)-1, .prebuf=(uint32_t)-1, .minreq=(uint32_t)-1, .fragsize=480*8};
  if (pa_stream_connect_record(tap->stream, monitor, &buffer, PA_STREAM_ADJUST_LATENCY | PA_STREAM_DONT_MOVE) < 0)
    fail("Cannot capture selected audio source");
}

static void app_sink(pa_context *context, const pa_sink_info *info, int end, void *userdata) {
  (void)context;
  uint32_t index = GPOINTER_TO_UINT(userdata);
  if (end < 0) { fail("Application output disappeared"); return; }
  if (!end && info->monitor_source_name) add_tap(index, info->index, info->monitor_source_name);
}

static void input_info(pa_context *context, const pa_sink_input_info *info, int end, void *unused) {
  (void)unused;
  if (end) { if (listing) pulse_done = 1; return; }
  const char *pid_text = pa_proplist_gets(info->proplist, PA_PROP_APPLICATION_PROCESS_ID);
  long pid = pid_text ? strtol(pid_text, NULL, 10) : 0;
  if (listing) {
    const char *name = pa_proplist_gets(info->proplist, PA_PROP_APPLICATION_NAME);
    char *id = add_app(application_process(pid), name ? name : info->name); g_free(id);
  } else if (app_pid && belongs(pid)) {
    pa_operation *operation = pa_context_get_sink_info_by_index(context, info->sink, app_sink, GUINT_TO_POINTER(info->index));
    if (operation) pa_operation_unref(operation);
  }
}

static void sink_info(pa_context *context, const pa_sink_info *info, int end, void *unused) {
  (void)unused;
  if (end) {
    if (listing) {
      pa_operation *operation = pa_context_get_sink_input_info_list(context, input_info, NULL);
      if (operation) pa_operation_unref(operation); else pulse_done = 1;
    } else if (!app_pid && !g_hash_table_size(taps)) fail("Selected output is no longer available");
    return;
  }
  if (!info->monitor_source_name) return;
  if (listing) {
    if (outputs->len) g_string_append_c(outputs, ',');
    char *id = g_strconcat("output:", info->monitor_source_name, NULL);
    g_string_append(outputs, "{\"id\":"); quote(outputs, id); g_free(id);
    g_string_append(outputs, ",\"label\":"); quote(outputs, info->description ? info->description : info->name);
    g_string_append_printf(outputs, ",\"kind\":\"output\",\"default\":%s}", g_strcmp0(default_sink, info->name) == 0 ? "true" : "false");
  } else if (!app_pid && g_strcmp0(audio_id + 7, info->monitor_source_name) == 0) add_tap(PA_INVALID_INDEX, info->index, info->monitor_source_name);
}

static void subscribed(pa_context *context, pa_subscription_event_type_t type, uint32_t index, void *unused) {
  (void)unused;
  if ((type & PA_SUBSCRIPTION_EVENT_FACILITY_MASK) != PA_SUBSCRIPTION_EVENT_SINK_INPUT) return;
  if ((type & PA_SUBSCRIPTION_EVENT_TYPE_MASK) == PA_SUBSCRIPTION_EVENT_REMOVE) g_hash_table_remove(taps, GUINT_TO_POINTER(index));
  else {
    pa_operation *operation = pa_context_get_sink_input_info(context, index, input_info, NULL);
    if (operation) pa_operation_unref(operation);
  }
}

static void server_info(pa_context *context, const pa_server_info *info, void *unused) {
  (void)unused;
  if (!info) { pulse_done = 1; if (!listing) fail("Audio server unavailable"); return; }
  default_sink = g_strdup(info->default_sink_name);
  pa_operation *operation = pa_context_get_sink_info_list(context, sink_info, NULL);
  if (operation) pa_operation_unref(operation);
  if (!listing && app_pid) {
    pa_context_set_subscribe_callback(context, subscribed, NULL);
    operation = pa_context_subscribe(context, PA_SUBSCRIPTION_MASK_SINK_INPUT, NULL, NULL);
    if (operation) pa_operation_unref(operation);
    operation = pa_context_get_sink_input_info_list(context, input_info, NULL);
    if (operation) pa_operation_unref(operation);
  }
}

static void pulse_state(pa_context *context, void *unused) {
  (void)unused;
  if (pa_context_get_state(context) == PA_CONTEXT_READY) {
    pulse_ready = 1;
    pa_operation *operation = pa_context_get_server_info(context, server_info, NULL);
    if (operation) pa_operation_unref(operation);
  } else if (pa_context_get_state(context) == PA_CONTEXT_FAILED || pa_context_get_state(context) == PA_CONTEXT_TERMINATED) {
    pulse_done = 1;
    if (!listing && !stopping) fail("Connect to PulseAudio or PipeWire PulseAudio service");
  }
}

static gboolean pulse_iterate(gpointer unused) {
  (void)unused;
  if (app_pid && process_start(app_pid, NULL) != app_start) { fail("Selected application ended"); return G_SOURCE_REMOVE; }
  for (int i = 0; i < 32; i++) {
    int result = pa_mainloop_iterate(pulse_loop, 0, NULL);
    if (result <= 0) break;
  }
  return G_SOURCE_CONTINUE;
}

static void connect_pulse(void) {
  pulse_loop = pa_mainloop_new();
  pulse = pa_context_new(pa_mainloop_get_api(pulse_loop), "Haunt screen audio");
  pa_context_set_state_callback(pulse, pulse_state, NULL);
  if (pa_context_connect(pulse, NULL, PA_CONTEXT_NOAUTOSPAWN, NULL) < 0) {
    pulse_done = 1; if (!listing) fail("Audio server unavailable");
  }
}

static gboolean make_audio(void) {
  if (!audio_id) return TRUE;
  char trailing;
  if (g_str_has_prefix(audio_id, "app:")) {
    if (sscanf(audio_id, "app:%ld:%" G_GUINT64_FORMAT "%c", &app_pid, &app_start, &trailing) != 2 || !app_start || process_start(app_pid, NULL) != app_start) { fail("Selected application is no longer available"); return FALSE; }
  } else if (!g_str_has_prefix(audio_id, "output:") || !audio_id[7]) { fail("Invalid audio source"); return FALSE; }
  GError *error = NULL;
  audio = gst_parse_launch("audiomixer name=mix force-live=true ignore-inactive-pads=true ! audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved ! appsink name=capture emit-signals=true sync=false max-buffers=12 drop=true audiotestsrc is-live=true wave=silence ! audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved ! mix.", &error);
  if (error) { fail(error->message); g_error_free(error); return FALSE; }
  mixer = gst_bin_get_by_name(GST_BIN(audio), "mix");
  timestamp_origin = (guint64)g_get_monotonic_time() * 1000;
  if (!play(audio, 4)) return FALSE;
  connect_pulse(); pulse_timer = g_timeout_add(5, pulse_iterate, NULL);
  return !status;
}

static void portal_response(GDBusConnection *connection, const char *sender, const char *object, const char *interface, const char *signal, GVariant *parameters, gpointer unused) {
  (void)connection; (void)sender; (void)object; (void)interface; (void)signal; (void)unused;
  g_variant_get(parameters, "(u@a{sv})", &response_code, &response);
  g_main_loop_quit(request_loop);
}

static gboolean request_timeout(gpointer unused) { (void)unused; fail("Screen capture portal timed out"); return G_SOURCE_REMOVE; }

static GVariant *portal_request(const char *method, GVariant *parameters, const char *token) {
  const char *unique = g_dbus_connection_get_unique_name(bus);
  char *sender = g_strdup(unique + 1);
  for (char *p = sender; *p; p++) if (*p == '.') *p = '_';
  char *path = g_strdup_printf("/org/freedesktop/portal/desktop/request/%s/%s", sender, token);
  g_free(sender); response = NULL; response_code = 2;
  request_loop = g_main_loop_new(NULL, FALSE);
  guint subscription = g_dbus_connection_signal_subscribe(bus, "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response", path, NULL, G_DBUS_SIGNAL_FLAGS_NONE, portal_response, NULL, NULL);
  GError *error = NULL;
  GVariant *reply = g_dbus_connection_call_sync(bus, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.ScreenCast", method, parameters, G_VARIANT_TYPE("(o)"), G_DBUS_CALL_FLAGS_NONE, 15000, NULL, &error);
  if (reply) {
    g_variant_unref(reply);
    guint timeout = g_timeout_add_seconds(120, request_timeout, NULL);
    if (!response && !stopping) g_main_loop_run(request_loop);
    if (g_main_context_find_source_by_id(NULL, timeout)) g_source_remove(timeout);
  } else { fail(error->message); g_error_free(error); }
  g_dbus_connection_signal_unsubscribe(bus, subscription);
  g_main_loop_unref(request_loop); request_loop = NULL;
  if (response_code || !response || stopping) {
    g_dbus_connection_call(bus, "org.freedesktop.portal.Desktop", path, "org.freedesktop.portal.Request", "Close", NULL, NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, NULL, NULL);
    if (!status) fail(response_code == 1 || stopping ? "Capture cancelled" : "Screen capture portal denied the request");
    g_clear_pointer(&response, g_variant_unref);
  }
  g_free(path); return response;
}

static void portal_closed(GDBusConnection *connection, const char *sender, const char *object, const char *interface, const char *signal, GVariant *parameters, gpointer unused) {
  (void)connection; (void)sender; (void)object; (void)interface; (void)signal; (void)parameters; (void)unused;
  fail("Screen sharing permission ended");
}

static gboolean open_portal(guint kind) {
  GError *error = NULL;
  bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) { fail(error->message); g_error_free(error); return FALSE; }
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string("haunt_create"));
  g_variant_builder_add(&options, "{sv}", "session_handle_token", g_variant_new_string("haunt_capture"));
  GVariant *result = portal_request("CreateSession", g_variant_new("(a{sv})", &options), "haunt_create");
  if (!result) return FALSE;
  g_variant_lookup(result, "session_handle", "s", &session); g_variant_unref(result);
  if (!session) { fail("Screen capture portal omitted its session"); return FALSE; }
  g_dbus_connection_signal_subscribe(bus, "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Session", "Closed", session, NULL, G_DBUS_SIGNAL_FLAGS_NONE, portal_closed, NULL, NULL);
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string("haunt_select"));
  g_variant_builder_add(&options, "{sv}", "types", g_variant_new_uint32(kind));
  g_variant_builder_add(&options, "{sv}", "multiple", g_variant_new_boolean(FALSE));
  g_variant_builder_add(&options, "{sv}", "cursor_mode", g_variant_new_uint32(2));
  result = portal_request("SelectSources", g_variant_new("(oa{sv})", session, &options), "haunt_select");
  if (!result) return FALSE;
  g_variant_unref(result);
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string("haunt_start"));
  result = portal_request("Start", g_variant_new("(osa{sv})", session, "", &options), "haunt_start");
  if (!result) return FALSE;
  GVariant *streams = g_variant_lookup_value(result, "streams", G_VARIANT_TYPE("a(ua{sv})"));
  if (!streams || g_variant_n_children(streams) != 1) { fail("Screen capture portal did not provide one source"); g_variant_unref(result); if (streams) g_variant_unref(streams); return FALSE; }
  GVariant *entry = g_variant_get_child_value(streams, 0), *properties;
  g_variant_get(entry, "(u@a{sv})", &node_id, &properties);
  g_variant_lookup(properties, "size", "(ii)", &source_width, &source_height);
  guint actual = 0;
  if (g_variant_lookup(properties, "source_type", "u", &actual) && actual != kind) fail("Portal returned a different capture type");
  g_variant_unref(properties); g_variant_unref(entry); g_variant_unref(streams); g_variant_unref(result);
  if (status) return FALSE;
  GUnixFDList *fds = NULL;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  result = g_dbus_connection_call_with_unix_fd_list_sync(bus, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.ScreenCast", "OpenPipeWireRemote", g_variant_new("(oa{sv})", session, &options), G_VARIANT_TYPE("(h)"), G_DBUS_CALL_FLAGS_NONE, 15000, NULL, &fds, NULL, &error);
  if (!result) { fail(error->message); g_error_free(error); return FALSE; }
  int handle; g_variant_get(result, "(h)", &handle); g_variant_unref(result);
  remote_fd = g_unix_fd_list_get(fds, handle, &error); g_object_unref(fds);
  if (remote_fd < 0) { fail(error->message); g_error_free(error); return FALSE; }
  return TRUE;
}

static int xerror(Display *display, XErrorEvent *event) { (void)display; (void)event; return 0; }

static char *window_property(Display *display, Window window, const char *name, Atom requested, unsigned long *count) {
  Atom actual; int format; unsigned long remaining; unsigned char *data = NULL;
  if (XGetWindowProperty(display, window, XInternAtom(display, name, False), 0, 65536, False, requested, &actual, &format, count, &remaining, &data) != Success) return NULL;
  return (char *)data;
}

static gboolean x11_sources(const char *selected, GString *screens) {
  Display *display = XOpenDisplay(NULL);
  if (!display) { fail("X11 display is unavailable"); return FALSE; }
  XSetErrorHandler(xerror);
  Window root = DefaultRootWindow(display);
  gboolean found = selected == NULL;
  int count = 0; XRRMonitorInfo *monitors = XRRGetMonitors(display, root, True, &count);
  for (int i = 0; i < count; i++) {
    char *id = g_strdup_printf("screen:%d:0", i);
    if (!selected) {
      if (screens->len) g_string_append_c(screens, ',');
      char *name = XGetAtomName(display, monitors[i].name);
      g_string_append_printf(screens, "{\"id\":\"%s\",\"width\":%d,\"height\":%d,\"name\":", id, monitors[i].width, monitors[i].height);
      quote(screens, name); g_string_append_c(screens, '}'); if (name) XFree(name);
    } else if (!strcmp(selected, id)) {
      screen_x = monitors[i].x; screen_y = monitors[i].y; screen_width = source_width = monitors[i].width; screen_height = source_height = monitors[i].height; found = TRUE;
    }
    g_free(id);
  }
  if (monitors) XRRFreeMonitors(monitors);
  unsigned long n = 0;
  Window *windows = (Window *)window_property(display, root, "_NET_CLIENT_LIST", XA_WINDOW, &n);
  for (unsigned long i = 0; windows && i < n && i < 512; i++) {
    XWindowAttributes attributes;
    if (!XGetWindowAttributes(display, windows[i], &attributes) || attributes.map_state != IsViewable || attributes.width < 2 || attributes.height < 2) continue;
    char *id = g_strdup_printf("window:%lu:0", windows[i]);
    if (!selected) {
      unsigned long length = 0;
      char *name = window_property(display, windows[i], "_NET_WM_NAME", XInternAtom(display, "UTF8_STRING", False), &length);
      if (!name) XFetchName(display, windows[i], &name);
      unsigned long *pid = (unsigned long *)window_property(display, windows[i], "_NET_WM_PID", XA_CARDINAL, &length);
      char *audio_source = pid && length ? add_app(application_process((long)*pid), name ? name : "Application") : NULL;
      if (screens->len) g_string_append_c(screens, ',');
      g_string_append_printf(screens, "{\"id\":\"%s\",\"width\":%d,\"height\":%d,\"name\":", id, attributes.width, attributes.height); quote(screens, name);
      if (audio_source) { g_string_append(screens, ",\"audioId\":"); quote(screens, audio_source); g_free(audio_source); }
      g_string_append_c(screens, '}'); if (pid) XFree(pid); if (name) XFree(name);
    } else if (!strcmp(selected, id)) { xid = windows[i]; source_width = attributes.width; source_height = attributes.height; found = TRUE; }
    g_free(id);
  }
  if (windows) XFree(windows);
  XCloseDisplay(display);
  if (!found) fail("Selected screen or window is no longer available");
  return found;
}

static gboolean is_wayland(void) { const char *name = g_getenv("WAYLAND_DISPLAY"); return g_strcmp0(g_getenv("XDG_SESSION_TYPE"), "wayland") == 0 || (name && *name); }

static guint portal_types(void) {
  GDBusConnection *connection = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!connection) return 0;
  GVariant *reply = g_dbus_connection_call_sync(connection, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.DBus.Properties", "Get", g_variant_new("(ss)", "org.freedesktop.portal.ScreenCast", "AvailableSourceTypes"), G_VARIANT_TYPE("(v)"), G_DBUS_CALL_FLAGS_NONE, 5000, NULL, NULL);
  guint types = 0;
  if (reply) { GVariant *value; g_variant_get(reply, "(v)", &value); types = g_variant_get_uint32(value); g_variant_unref(value); g_variant_unref(reply); }
  g_object_unref(connection); return types;
}

static void list_sources(void) {
  listing = 1; connect_pulse();
  gint64 until = g_get_monotonic_time() + 4000000;
  while (!pulse_done && g_get_monotonic_time() < until) { pulse_iterate(NULL); g_usleep(1000); }
  GString *screens = g_string_new(NULL);
  if (is_wayland()) {
    guint types = portal_types();
    if (types & 1) g_string_append(screens, "{\"id\":\"portal:screen\",\"name\":\"Choose a screen…\"}");
    if (types & 2) { if (screens->len) g_string_append_c(screens, ','); g_string_append(screens, "{\"id\":\"portal:window\",\"name\":\"Choose a window…\"}"); }
    if (!types) fail("Screen sharing portal is unavailable");
  } else x11_sources(NULL, screens);
  printf("{\"screens\":[%s],\"cameras\":[],\"audio\":[],\"audioSources\":[%s%s%s],\"audioError\":%s}\n", screens->str, outputs->str, outputs->len && apps->len ? "," : "", apps->str, pulse_ready ? "null" : "\"Connect to PulseAudio or PipeWire PulseAudio service to share audio.\"");
  g_string_free(screens, TRUE);
}

static gboolean control(GIOChannel *channel, GIOCondition condition, gpointer unused) {
  (void)unused;
  if (condition & (G_IO_HUP | G_IO_ERR)) return stop(NULL);
  char *line = NULL;
  if (g_io_channel_read_line(channel, &line, NULL, NULL, NULL) != G_IO_STATUS_NORMAL) return G_SOURCE_CONTINUE;
  int w, h, rate; char extra;
  if (!strcmp(line, "stop\n")) { g_free(line); return stop(NULL); }
  if (sscanf(line, "configure %d %d %d %c", &w, &h, &rate, &extra) != 3 || w < 2 || h < 2 || w > 8192 || h > 8192 || (rate != 15 && rate != 30 && rate != 60)) fail("Invalid capture mode");
  else if (video) {
    if (window_timer) { g_source_remove(window_timer); window_timer = 0; }
    GstBus *messages = gst_element_get_bus(video);
    gst_bus_remove_watch(messages); gst_object_unref(messages);
    gst_element_set_state(video, GST_STATE_NULL); gst_object_unref(video); video = NULL;
    output_width = w; output_height = h; fps = rate;
    video_origin = (guint64)g_get_monotonic_time() * 1000;
    make_video();
  }
  g_free(line); return G_SOURCE_CONTINUE;
}

int main(int argc, char **argv) {
  XInitThreads(); signal(SIGPIPE, SIG_IGN);
  gst_init(NULL, NULL);
  loop = g_main_loop_new(NULL, FALSE);
  taps = g_hash_table_new_full(g_direct_hash, g_direct_equal, NULL, tap_free);
  seen_apps = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
  outputs = g_string_new(NULL); apps = g_string_new(NULL);
  if (argc == 2 && !strcmp(argv[1], "--list-sources")) list_sources();
  else if (argc == 6 || argc == 7) {
    load_nvidia_plugins();
    char *end;
    output_width = (int)strtol(argv[3], &end, 10); if (*end) return 2;
    output_height = (int)strtol(argv[4], &end, 10); if (*end) return 2;
    fps = (int)strtol(argv[5], &end, 10); if (*end) return 2;
    if (strcmp(argv[1], "--capture") || output_width < 2 || output_height < 2 || output_width > 8192 || output_height > 8192 || (fps != 15 && fps != 30 && fps != 60)) return 2;
    if (argc == 7) audio_id = argv[6];
    g_unix_signal_add(SIGTERM, stop, NULL); g_unix_signal_add(SIGINT, stop, NULL);
    GIOChannel *input = g_io_channel_unix_new(0);
    g_io_add_watch(input, G_IO_IN | G_IO_HUP | G_IO_ERR, control, NULL);
    gboolean selected = FALSE;
    if (is_wayland()) {
      if (!strcmp(argv[2], "portal:screen")) selected = open_portal(1);
      else if (!strcmp(argv[2], "portal:window")) selected = open_portal(2);
      else fail("Invalid Wayland capture source");
    } else selected = x11_sources(argv[2], NULL);
    if (selected && xid) selected = open_window();
    if (selected && (source_width < 2 || source_height < 2)) fail("Capture source did not report its size");
    timestamp_origin = (guint64)g_get_monotonic_time() * 1000;
    video_origin = timestamp_origin;
    if (selected && !status && make_video() && make_audio()) g_main_loop_run(loop);
    g_io_channel_unref(input);
  } else status = 2;
  stopping = TRUE;
  if (window_timer) g_source_remove(window_timer);
  if (pulse_timer && g_main_context_find_source_by_id(NULL, pulse_timer)) g_source_remove(pulse_timer);
  g_hash_table_remove_all(taps);
  if (video) { gst_element_set_state(video, GST_STATE_NULL); gst_object_unref(video); }
  if (window_display) {
    if (window_pixmap) XFreePixmap(window_display, window_pixmap);
    XCompositeUnredirectWindow(window_display, xid, CompositeRedirectAutomatic);
    XCloseDisplay(window_display);
  }
  if (audio) { gst_element_set_state(audio, GST_STATE_NULL); gst_object_unref(audio); }
  if (mixer) gst_object_unref(mixer);
  if (session) { g_dbus_connection_call_sync(bus, "org.freedesktop.portal.Desktop", session, "org.freedesktop.portal.Session", "Close", NULL, NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, NULL); g_free(session); }
  if (remote_fd >= 0) close(remote_fd);
  if (bus) g_object_unref(bus);
  if (pulse) { pa_context_disconnect(pulse); pa_context_unref(pulse); pa_mainloop_free(pulse_loop); }
  g_hash_table_unref(taps); g_hash_table_unref(seen_apps);
  g_string_free(outputs, TRUE); g_string_free(apps, TRUE); g_free(default_sink);
  g_main_loop_unref(loop);
  return status;
}
