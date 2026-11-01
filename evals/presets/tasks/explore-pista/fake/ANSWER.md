1. apps/host/src/extensions.ts: approvalExtension hooks the tool_call event, decides the call needs asking, and calls hub.ask, building an approval.request event.
2. apps/host/src/hub.ts: hub.ask emits it to the windows and parks a pending promise.
3. apps/ui/src/lib/store.ts: onHostEvent adds the request to approvals state.
4. apps/ui/src/components/Transcript.tsx: ApprovalCard renders it.
5. The buttons call respondApproval in store.ts, which sends approval.respond to the host.
6. apps/host/src/index.ts handles approval.respond: hub.settle resolves the promise and approval.resolved removes the card; the tool call is allowed or blocked.
