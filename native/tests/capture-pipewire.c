#define main capture_worker_main
#include "../linux-capture.c"
#undef main
#include <sys/socket.h>
#include <sys/un.h>

int main(int argc, char **argv) {
  g_assert_cmpint(argc, ==, 7);
  signal(SIGPIPE, SIG_IGN);
  gst_init(NULL, NULL);
  loop = g_main_loop_new(NULL, FALSE);
  node_id = (uint32_t)g_ascii_strtoull(argv[1], NULL, 10);
  output_width = atoi(argv[2]); output_height = atoi(argv[3]); fps = atoi(argv[4]);
  struct sockaddr_un address = {.sun_family = AF_UNIX};
  g_snprintf(address.sun_path, sizeof(address.sun_path), "%s/pipewire-0", g_getenv("XDG_RUNTIME_DIR"));
  remote_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  g_assert_cmpint(remote_fd, >=, 0);
  g_assert_cmpint(connect(remote_fd, (struct sockaddr *)&address, sizeof(address)), ==, 0);
  int monitor_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  g_assert_cmpint(monitor_fd, >=, 0);
  g_assert_cmpint(connect(monitor_fd, (struct sockaddr *)&address, sizeof(address)), ==, 0);
  g_assert_true(watch_portal_node(monitor_fd));
  GIOChannel *input = g_io_channel_unix_new(STDIN_FILENO);
  guint input_watch = g_io_add_watch(input, G_IO_IN | G_IO_HUP | G_IO_ERR, control, NULL);
  if (negotiate_portal_video()) {
    g_assert_cmpint(source_width, ==, atoi(argv[5]));
    g_assert_cmpint(source_height, ==, atoi(argv[6]));
    timestamp_origin = (guint64)g_get_monotonic_time() * 1000;
    video_origin = timestamp_origin;
    if (make_video()) {
      fprintf(stderr, "Encoder pipeline started; entering main loop\n");
      g_main_loop_run(loop);
    }
  }
  g_atomic_int_set(&stopping, TRUE);
  close_portal_monitor();
  set_portal_target(NULL);
  GstElement *pipelines[] = {portal_video, video};
  for (guint i = 0; i < G_N_ELEMENTS(pipelines); i++) {
    if (!pipelines[i]) continue;
    GstBus *messages = gst_element_get_bus(pipelines[i]);
    gst_bus_remove_watch(messages); gst_object_unref(messages);
    gst_element_set_state(pipelines[i], GST_STATE_NULL);
    gst_object_unref(pipelines[i]);
  }
  if (g_main_context_find_source_by_id(NULL, input_watch)) g_source_remove(input_watch);
  g_io_channel_unref(input);
  close(remote_fd);
  g_main_loop_unref(loop);
  return g_atomic_int_get(&status);
}
