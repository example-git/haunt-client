import { spawn } from "node:child_process";
const rawSoak = process.env.HAUNT_CALL_SOAK_SECONDS;
const soak = rawSoak === undefined ? 0 : Number(rawSoak);
if (
  rawSoak !== undefined &&
  (!/^\d+$/.test(rawSoak) ||
    !Number.isInteger(soak) ||
    soak < 30 ||
    soak > 1800)
)
  throw Error("HAUNT_CALL_SOAK_SECONDS must be an integer from 30 to 1800");
if (soak && process.env.HAUNT_CLIENT_CHECK !== "source-audio")
  throw Error("Call endurance requires HAUNT_CLIENT_CHECK=source-audio");
const child = spawn(
  "go",
  [
    "test",
    "-tags=webclient",
    "./internal/clienttest",
    "-run",
    "TestClients",
    "-count=1",
    "-v",
    `-timeout=${600 + 2 * soak}s`,
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
