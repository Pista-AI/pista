import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSnapshot, frameNotes, type FrameReport, type PageSnapshot } from "../src/page-scripts.ts";

const report = (frames: FrameReport["frames"], textChars = 0): FrameReport => ({ frames, vw: 1280, vh: 720, textChars });
const big = { src: "https://payments.google.com/payments/u/1/timelineview?ac=abcdefghijklmnop&hl=en", w: 800, h: 600, vis: 480000 };
const widget = { src: "https://ogs.google.com/widget/app", w: 1, h: 1, vis: 1 };
const hidden = { src: "https://ads.example.com/x", w: 0, h: 0, vis: 0 };
const snap = (frames?: FrameReport, count = 0): PageSnapshot => ({ lines: [], count, omitted: 0, scroll: { y: 0, height: 700, viewport: 720 }, elements: [], ...(frames ? { frames } : {}) });

test("no frames: no section, no hint, header unchanged", () => {
  assert.deepEqual(frameNotes(undefined), { section: [] });
  assert.equal(formatSnapshot(snap()).split("\n")[0], "0 interactive elements. Whole page fits in the viewport.");
});

test("frames are listed biggest first with trimmed src; small and hidden frames are only counted", () => {
  const { section } = frameNotes(report([widget, { ...big, w: 300, h: 200, src: "https://a.example/small" }, big, hidden]));
  assert.deepEqual(section, ["Frames (not included in this view):", "  800x600 https://payments.google.com/payments/u/1/timelineview?…", "  300x200 https://a.example/small", "  +2 small/hidden frames"]);
});

test("a nearly empty top frame with a large visible iframe gets the navigate hint with the full URL", () => {
  const { hint } = frameNotes(report([widget, big], 40));
  assert.equal(hint, `Main content appears to be in an iframe ${big.src}; call browser_navigate to that URL to work with it.`);
  const text = formatSnapshot(snap(report([widget, big], 40)));
  const [head, , , ...rest] = text.split("\n");
  assert.match(head!, /Whole page fits in the viewport\. Main content appears to be in an iframe https:\/\/payments\.google\.com\S+; call browser_navigate .*$/);
  assert.equal(rest.at(-3), "Frames (not included in this view):");
  assert.equal(rest.at(-1), "  +1 small/hidden frame");
});

test("no hint when the top frame has plenty of content or the frame is small", () => {
  assert.equal(frameNotes(report([big], 5000)).hint, undefined);
  assert.equal(frameNotes(report([big], 40), 12).hint, undefined);
  assert.equal(frameNotes(report([widget], 0)).hint, undefined);
  assert.equal(frameNotes(report([{ ...big, vis: 0 }], 0)).hint, undefined);
});

test("no hint for a non-http(s) frame, but it is still listed", () => {
  for (const src of ["javascript:void(0)", "data:text/html,hi", "blob:https://a.example/1", "about:srcdoc"]) {
    const n = frameNotes(report([{ ...big, src }], 0));
    assert.equal(n.hint, undefined, src);
    assert.equal(n.section[1], `  800x600 ${src}`);
  }
});

test("media and map embeds are listed but never hinted", () => {
  for (const src of ["https://www.youtube.com/embed/x", "https://www.youtube-nocookie.com/embed/x", "https://player.vimeo.com/video/1", "https://www.google.com/maps/embed?pb=1", "https://maps.google.com/?q=x"]) {
    const n = frameNotes(report([{ ...big, src }], 0));
    assert.equal(n.hint, undefined, src);
    assert.equal(n.section.length, 2, src);
  }
  assert.ok(frameNotes(report([{ ...big, src: "https://www.google.com/other" }], 0)).hint);
});

test("an explicit text length overrides the report's (browser_read path)", () => {
  assert.ok(frameNotes(report([big], 0), 0, 10).hint);
  assert.equal(frameNotes(report([big], 0), 0, 5000).hint, undefined);
});
