#include <pipewire/pipewire.h>
#include <spa/param/video/format-utils.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct source {
  struct pw_main_loop *loop;
  struct pw_stream *stream;
  struct spa_source *timer;
  int width, height, stride, min_buffers, max_buffers, format, frames, result;
  unsigned allocated;
  bool silent;
};

static void frame(void *userdata) {
  struct source *source = userdata;
  struct pw_buffer *buffer = pw_stream_dequeue_buffer(source->stream);
  if (!buffer) return;
  struct spa_data *data = &buffer->buffer->datas[0];
  if (!data->data || data->maxsize < (unsigned)(source->stride * source->height)) {
    fprintf(stderr, "Invalid source buffer storage\n");
    source->result = 1;
    pw_main_loop_quit(source->loop);
    return;
  }
  unsigned char *pixels = data->data;
  memset(pixels, 0xa5, data->maxsize);
  for (int y = 0; y < source->height; y++) {
    for (int x = 0; x < source->width; x++) {
      unsigned char *pixel = pixels + y * source->stride + x * 4;
      bool red = x < source->width / 2;
      pixel[0] = source->format == SPA_VIDEO_FORMAT_RGBx ? (red ? 224 : 32) : 64;
      pixel[1] = red ? 32 : 224;
      pixel[2] = source->format == SPA_VIDEO_FORMAT_RGBx ? 64 : (red ? 224 : 32);
      pixel[3] = 255;
    }
  }
  struct spa_meta_header *header = spa_buffer_find_meta_data(buffer->buffer, SPA_META_Header, sizeof(*header));
  if (header) {
    header->pts = -1; header->seq = source->frames; header->flags = 0; header->dts_offset = 0;
  }
  data->chunk->offset = 0;
  data->chunk->size = source->stride * source->height;
  data->chunk->stride = source->stride;
  source->frames++;
  pw_stream_queue_buffer(source->stream, buffer);
}

static void tick(void *userdata, uint64_t expirations) {
  (void)expirations;
  struct source *source = userdata;
  if (!source->silent) pw_stream_trigger_process(source->stream);
}

static void state(void *userdata, enum pw_stream_state old, enum pw_stream_state current, const char *error) {
  (void)old;
  struct source *source = userdata;
  fprintf(stderr, "Source state: %s %s\n", pw_stream_state_as_string(current), error ? error : "");
  if (current == PW_STREAM_STATE_ERROR) {
    source->result = 1;
    pw_main_loop_quit(source->loop);
  } else if (current == PW_STREAM_STATE_PAUSED) {
    printf("%u\n", pw_stream_get_node_id(source->stream)); fflush(stdout);
    pw_loop_update_timer(pw_main_loop_get_loop(source->loop), source->timer, NULL, NULL, false);
  } else if (current == PW_STREAM_STATE_STREAMING) {
    struct timespec start = {.tv_nsec = 1}, interval = {.tv_nsec = 16666667};
    pw_loop_update_timer(pw_main_loop_get_loop(source->loop), source->timer, &start, &interval, false);
  }
}

static void format(void *userdata, uint32_t id, const struct spa_pod *param) {
  if (id != SPA_PARAM_Format || !param) return;
  struct source *source = userdata;
  uint8_t storage[1024];
  struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(storage, sizeof(storage));
  const struct spa_pod *params[] = {
    spa_pod_builder_add_object(&builder, SPA_TYPE_OBJECT_ParamBuffers, SPA_PARAM_Buffers,
      SPA_PARAM_BUFFERS_buffers, SPA_POD_CHOICE_RANGE_Int(source->min_buffers, source->min_buffers, source->max_buffers),
      SPA_PARAM_BUFFERS_blocks, SPA_POD_Int(1),
      SPA_PARAM_BUFFERS_size, SPA_POD_Int(source->stride * source->height),
      SPA_PARAM_BUFFERS_stride, SPA_POD_Int(source->stride),
      SPA_PARAM_BUFFERS_dataType, SPA_POD_CHOICE_FLAGS_Int(1 << SPA_DATA_MemFd)),
    spa_pod_builder_add_object(&builder, SPA_TYPE_OBJECT_ParamMeta, SPA_PARAM_Meta,
      SPA_PARAM_META_type, SPA_POD_Id(SPA_META_Header),
      SPA_PARAM_META_size, SPA_POD_Int(sizeof(struct spa_meta_header)))
  };
  pw_stream_update_params(source->stream, params, SPA_N_ELEMENTS(params));
}

static void added(void *userdata, struct pw_buffer *buffer) {
  (void)buffer;
  struct source *source = userdata;
  source->allocated++;
  fprintf(stderr, "Allocated buffer %u (allowed %d..%d)\n", source->allocated, source->min_buffers, source->max_buffers);
  if (source->allocated > (unsigned)source->max_buffers) {
    source->result = 1;
    pw_main_loop_quit(source->loop);
  }
}

static void quit(void *userdata, int signal_number) {
  (void)signal_number;
  pw_main_loop_quit(((struct source *)userdata)->loop);
}

int main(int argc, char **argv) {
  if (argc != 8) return 2;
  struct source source = {.width = atoi(argv[1]), .height = atoi(argv[2]),
    .min_buffers = atoi(argv[3]), .max_buffers = atoi(argv[4]),
    .format = !strcmp(argv[5], "RGBx") ? SPA_VIDEO_FORMAT_RGBx : SPA_VIDEO_FORMAT_BGRx,
    .silent = !strcmp(argv[7], "silent")};
  source.stride = source.width * 4 + atoi(argv[6]);
  pw_init(NULL, NULL);
  source.loop = pw_main_loop_new(NULL);
  struct pw_loop *event_loop = pw_main_loop_get_loop(source.loop);
  pw_loop_add_signal(event_loop, SIGTERM, quit, &source);
  source.timer = pw_loop_add_timer(event_loop, tick, &source);
  const struct pw_stream_events events = {.version = PW_VERSION_STREAM_EVENTS,
    .state_changed = state, .param_changed = format, .process = frame, .add_buffer = added};
  source.stream = pw_stream_new_simple(event_loop, "Haunt native capture test source",
    pw_properties_new(PW_KEY_MEDIA_TYPE, "Video", PW_KEY_MEDIA_CATEGORY, "Capture",
      PW_KEY_MEDIA_ROLE, "Screen", PW_KEY_MEDIA_CLASS, "Video/Source",
      PW_KEY_NODE_DRIVER, "true", NULL), &events, &source);
  if (!source.stream) return 1;
  uint8_t storage[1024];
  struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(storage, sizeof(storage));
  struct spa_video_info_raw info = {.format = source.format,
    .size = SPA_RECTANGLE(source.width, source.height), .framerate = SPA_FRACTION(60, 1)};
  const struct spa_pod *params[] = {spa_format_video_raw_build(&builder, SPA_PARAM_EnumFormat, &info)};
  int result = pw_stream_connect(source.stream, PW_DIRECTION_OUTPUT, PW_ID_ANY,
    PW_STREAM_FLAG_DRIVER | PW_STREAM_FLAG_MAP_BUFFERS, params, 1);
  if (result < 0) return 1;
  pw_main_loop_run(source.loop);
  fprintf(stderr, "Produced %d frames with %u buffers\n", source.frames, source.allocated);
  pw_stream_destroy(source.stream);
  pw_loop_destroy_source(event_loop, source.timer);
  pw_main_loop_destroy(source.loop);
  pw_deinit();
  return source.result;
}
