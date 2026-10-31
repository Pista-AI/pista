// A minimal Pista harness: one prompt section and one trivial tool, no dependencies.
// The default export is a Harness object (or a function returning one).

const demo = {
  id: "demo",

  // Appended to the system prompt of top-level threads. Return undefined to add nothing.
  prompt: (host) => {
    const greeting = host.config()?.greeting ?? "Hello";
    return `Demo harness: when the user asks who you are, call the \`demo_hello\` tool first and greet with "${greeting}".`;
  },

  // An inline Pi extension, built once per thread. `host.runAgent` would run a child agent; unused here.
  extension: (host) => ({
    name: "demo",
    factory: (pi) => {
      pi.registerTool({
        name: "demo_hello",
        label: "Demo hello",
        description: "Returns the working directory of this thread. Call it when asked who you are.",
        // Pi types tool parameters as TypeBox, whose schemas are plain JSON Schema; Pi validates the arguments against this object, so a literal works and keeps the example dependency-free.
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: `demo harness active in ${host.cwd}` }], details: {} }),
      });
    },
  }),

  // Checks `harnessConfig.demo`; without it, settings are not validated.
  validateConfig: (raw) => raw !== null && typeof raw === "object" && (raw.greeting === undefined || typeof raw.greeting === "string"),
};

export default demo;
