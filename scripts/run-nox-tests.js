import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const environment = { ...process.env };
const dockerDesktopSocket = `${homedir()}/.docker/run/docker.sock`;

// The Nox plugin checks /var/run/docker.sock unless DOCKER_HOST is explicit.
// Docker Desktop on macOS exposes its socket under the user's Docker directory.
if (process.platform === "darwin" && existsSync(dockerDesktopSocket)) {
  environment.DOCKER_HOST = `unix://${dockerDesktopSocket}`;
}

const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(executable, ["exec", "hardhat", "test", ...process.argv.slice(2)], {
  env: environment,
  stdio: ["inherit", "pipe", "pipe"],
});

let testRunnerReportedFailure = false;
const forward = (chunk, destination) => {
  const text = chunk.toString();
  if (text.includes("Test run failed") || /\d+ failing \(\d+ nodejs\)/.test(text)) {
    testRunnerReportedFailure = true;
  }
  destination.write(chunk);
};

child.stdout.on("data", (chunk) => forward(chunk, process.stdout));
child.stderr.on("data", (chunk) => forward(chunk, process.stderr));

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`Hardhat test terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code !== 0 || testRunnerReportedFailure ? 1 : 0;
});
