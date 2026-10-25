/**
 * Who can lift a safety stop (see safety.ts): the user, through the host, and nobody else. The tools take no argument
 * for it, so the model cannot pass one. When a tool hits a stop it asks the user itself through
 * `BrowserToolOptions.askApproval`, naming the exact action (`clicking button "Place order"`). A generic approval of the
 * tool call that showed only a ref does not count: the user never saw what the ref was.
 *
 * With no approver (standalone, no window connected, a test run) or when it rejects, the stop stands and the tool result says so.
 */

/** Asks the user whether this one action may go ahead; `action` reads like `clicking button "Place order"`. Rejecting or returning false denies. `signal` is the run's abort signal: when it fires the ask is withdrawn, and a yes that arrives after it does nothing. */
export type RiskApprover = (request: { toolName: string; action: string; signal?: AbortSignal }) => Promise<boolean>;
