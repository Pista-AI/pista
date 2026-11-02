/** Switches that would expose the main process or renderers to a debugger; a packaged build refuses to start with any of them. */
const DEBUG_FLAGS = ["--remote-debugging-port", "--remote-debugging-pipe", "--inspect", "--inspect-brk", "--inspect-port", "--js-flags"];

/** The first debug switch in `argv` (`--flag` or `--flag=value`; `--inspect` also covers `--inspect-brk=...`), or undefined. */
export function findDebugFlag(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    const name = arg.split("=")[0]!;
    if (DEBUG_FLAGS.some((flag) => name === flag || name.startsWith(flag))) return name;
  }
  return undefined;
}
