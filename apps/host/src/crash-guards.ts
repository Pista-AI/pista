// A stray rejection or exception in one thread must not take the whole host down. Before the server is listening
// there is nothing to keep alive (e.g. EADDRINUSE), so a startup failure still exits non-zero.
export function installCrashGuards(isListening: () => boolean, log: (message: string) => void = console.error, exit: (code: number) => void = process.exit): void {
  const describe = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.on("unhandledRejection", (reason) => log(`[pista-host] unhandled rejection: ${describe(reason)}`));
  process.on("uncaughtException", (error) => {
    log(`[pista-host] uncaught exception: ${describe(error)}`);
    if (!isListening()) exit(1);
  });
}
