import { spawn } from "node:child_process";
const child = spawn(
  "go",
  [
    "test",
    "./internal/clienttest",
    "-run",
    "TestClients",
    "-count=1",
    "-v",
    "-timeout=10m",
  ],
  {
    cwd: new URL("../..", import.meta.url),
    stdio: "inherit",
    env: {
      ...process.env,
      DOCKER_HOST: "",
      DOCKER_CONTEXT: "",
      DOCKER_TLS: "",
      DOCKER_TLS_VERIFY: "",
      DOCKER_CERT_PATH: "",
      HAUNT_CLIENT_E2E: "1",
      HAUNT_TEST_DATABASE_URL:
        "postgres://postgres@127.0.0.1:32768/chatxo_check?sslmode=disable",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
