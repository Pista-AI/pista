export type { BrowserDriver, NativeInput, PageState } from "./driver.ts";
export { runPageAction, type ActionResult, type Approve, type PageAction } from "./actions.ts";
export type { RiskApprover } from "./approval.ts";
export { checkUrl, normalizeDomainPattern, guardDriver, DomainBlockedError, type DomainRules } from "./domains.ts";
export { registerBrowserTools, type BrowserToolOptions } from "./tools.ts";
export { CdpDriver } from "./drivers/cdp.ts";
export { PAGE_VIEW_TOOLS, prunePageViews, registerContextPruning, createPageViewCompactor, type CompactorOptions } from "./context.ts";
export {
  applyCollapse,
  collapsePageViews,
  DEFAULT_STALE_DOCUMENT_TURNS,
  type CollapseOptions,
  type CollapseResult,
  type CollapseState,
} from "./collapse.ts";
