// Tests must not depend on which browsers the machine has installed (the default engine is `auto`).
process.env.PISTA_BROWSER_DRIVER ??= "pane";
