#include <pulse/pulseaudio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static pa_mainloop *loop;
static pa_context *context;
static pa_stream *stream;
static const char *selected;
static char *default_sink;
static int count;
static int found;

static void fail(const char *message) {
  fprintf(stderr, "%s: %s\n", message, pa_strerror(pa_context_errno(context)));
  pa_mainloop_quit(loop, 1);
}

static void json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

static void read_audio(pa_stream *s, size_t available, void *userdata) {
  (void)available; (void)userdata;
  const void *data;
  size_t bytes;
  if (pa_stream_peek(s, &data, &bytes) < 0) { fail("Audio read failed"); return; }
  if (bytes) {
    if (data) {
      if (fwrite(data, 1, bytes, stdout) != bytes) { pa_mainloop_quit(loop, 1); return; }
    } else {
      unsigned char silence[4096] = {0};
      size_t remaining = bytes;
      while (remaining) {
        size_t n = remaining < sizeof(silence) ? remaining : sizeof(silence);
        if (fwrite(silence, 1, n, stdout) != n) { pa_mainloop_quit(loop, 1); return; }
        remaining -= n;
      }
    }
    fflush(stdout);
    pa_stream_drop(s);
  }
}

static void stream_state(pa_stream *s, void *userdata) {
  (void)userdata;
  switch (pa_stream_get_state(s)) {
    case PA_STREAM_READY: fputs("READY\n", stderr); fflush(stderr); break;
    case PA_STREAM_FAILED: fail("Output audio capture failed"); break;
    case PA_STREAM_TERMINATED: pa_mainloop_quit(loop, 0); break;
    default: break;
  }
}

static void sink_info(pa_context *c, const pa_sink_info *info, int end, void *userdata) {
  (void)userdata;
  if (end < 0) { fail("Cannot list audio outputs"); return; }
  if (end) {
    if (!selected) { puts("]"); pa_mainloop_quit(loop, 0); }
    else if (!found) {
      fputs("The selected audio output is no longer available\n", stderr);
      pa_mainloop_quit(loop, 1);
    }
    return;
  }
  if (!info->monitor_source_name) return;
  if (!selected) {
    if (count++) putchar(',');
    fputs("{\"id\":", stdout); json_string(info->monitor_source_name);
    fputs(",\"label\":", stdout); json_string(info->description ? info->description : info->name);
    printf(",\"default\":%s}", default_sink && strcmp(default_sink, info->name) == 0 ? "true" : "false");
  } else if (!found && strcmp(selected, info->monitor_source_name) == 0) {
    found = 1;
    pa_sample_spec format = { .format = PA_SAMPLE_FLOAT32LE, .rate = 48000, .channels = 2 };
    pa_channel_map channels;
    pa_channel_map_init_stereo(&channels);
    stream = pa_stream_new(c, "Haunt screen audio", &format, &channels);
    if (!stream) { fail("Cannot create output capture"); return; }
    pa_stream_set_state_callback(stream, stream_state, NULL);
    pa_stream_set_read_callback(stream, read_audio, NULL);
    pa_buffer_attr buffer = { .maxlength = 48000 * 8 / 4, .tlength = (uint32_t)-1, .prebuf = (uint32_t)-1, .minreq = (uint32_t)-1, .fragsize = 480 * 8 };
    if (pa_stream_connect_record(stream, selected, &buffer, PA_STREAM_ADJUST_LATENCY | PA_STREAM_DONT_MOVE) < 0)
      fail("Cannot capture the selected output");
  }
}

static void server_info(pa_context *c, const pa_server_info *info, void *userdata) {
  (void)userdata;
  if (!info) { fail("Audio server unavailable"); return; }
  default_sink = info->default_sink_name ? strdup(info->default_sink_name) : NULL;
  if (!selected) putchar('[');
  pa_operation *operation = pa_context_get_sink_info_list(c, sink_info, NULL);
  if (operation) pa_operation_unref(operation); else fail("Cannot query audio outputs");
}

static void context_state(pa_context *c, void *userdata) {
  (void)userdata;
  switch (pa_context_get_state(c)) {
    case PA_CONTEXT_READY: {
      pa_operation *operation = pa_context_get_server_info(c, server_info, NULL);
      if (operation) pa_operation_unref(operation); else fail("Cannot query the audio server");
      break;
    }
    case PA_CONTEXT_FAILED: fail("Connect to PulseAudio or PipeWire PulseAudio service"); break;
    case PA_CONTEXT_TERMINATED: pa_mainloop_quit(loop, 0); break;
    default: break;
  }
}

int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) return 2;
  if (argc == 2 && strcmp(argv[1], "list") != 0) return 2;
  if (argc == 3) {
    if (strcmp(argv[1], "record") != 0 || strlen(argv[2]) > 1024) return 2;
    selected = argv[2];
  }
  loop = pa_mainloop_new();
  if (!loop) return 1;
  context = pa_context_new(pa_mainloop_get_api(loop), "Haunt screen audio");
  if (!context) { pa_mainloop_free(loop); return 1; }
  pa_context_set_state_callback(context, context_state, NULL);
  int result = 1;
  if (pa_context_connect(context, NULL, PA_CONTEXT_NOAUTOSPAWN, NULL) < 0)
    fprintf(stderr, "Audio server connection failed: %s\n", pa_strerror(pa_context_errno(context)));
  else pa_mainloop_run(loop, &result);
  if (stream) { pa_stream_disconnect(stream); pa_stream_unref(stream); }
  pa_context_disconnect(context);
  pa_context_unref(context);
  pa_mainloop_free(loop);
  free(default_sink);
  return result;
}
