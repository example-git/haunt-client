// Public-domain ABI example and runtime fixture. This is a gain control, not a denoiser.
static float input[720], output[720];
int audio_init(void) { return 1; }
float *audio_input(void) { return input; }
float *audio_output(void) { return output; }
int audio_process(float gain) {
  for (int i = 0; i < 720; i++) output[i] = input[i] * gain;
  return 0;
}
void audio_reset(void) { for (int i=0;i<720;i++) input[i]=output[i]=0; }
