import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadActive, downloadLabel, downloadPhase, formatBytes, formatCtx, fraction, percent, pickerName, runtimeButtons, runtimeLabel } from "../src/lib/llama.ts";

test("formatBytes", () => {
  assert.equal(formatBytes(1_100_000_000), "1.1 GB");
  assert.equal(formatBytes(12_000_000), "12 MB");
  assert.equal(formatBytes(500), "1 KB");
});

test("formatCtx", () => {
  assert.equal(formatCtx(16384), "16k ctx");
  assert.equal(formatCtx(32768), "32k ctx");
  assert.equal(formatCtx(512), "512 ctx");
  assert.equal(formatCtx(undefined), "");
});

test("progress maths", () => {
  assert.equal(fraction({ bytes: 5, total: 10 }), 0.5);
  assert.equal(fraction({ bytes: 20, total: 10 }), 1);
  assert.equal(fraction({ bytes: 5 }), undefined);
  assert.equal(percent({ bytes: 42, total: 100 }), "42%");
  assert.equal(percent(undefined), "");
  assert.equal(downloadLabel({ spec: "a/b:Q8_0", bytes: 5_000_000, total: 10_000_000 }), "5 MB of 10 MB");
  assert.equal(downloadLabel({ spec: "a/b:Q8_0", bytes: 1, error: "boom" }), "boom");
  assert.equal(downloadLabel({ spec: "a/b:Q8_0", bytes: 1_500_000 }), "Downloading… 2 MB");
  assert.equal(downloadLabel({ spec: "a/b:Q8_0", bytes: 0 }), "Downloading…");
});

test("download phases and labels", () => {
  const spec = "a/b:Q8_0";
  assert.equal(downloadLabel({ spec, bytes: 0, phase: "starting" }), "Starting download…");
  assert.equal(downloadLabel({ spec, bytes: 0, phase: "done", done: true }), "Done");
  assert.equal(downloadLabel({ spec, bytes: 0, phase: "error", error: "No progress from the runtime for 45 s" }), "No progress from the runtime for 45 s");
  assert.equal(downloadPhase({ spec, bytes: 0 }), "downloading", "a host without phase: in flight until done or error");
  assert.equal(downloadPhase({ spec, bytes: 1, done: true }), "done");
  assert.equal(downloadPhase({ spec, bytes: 0, error: "x" }), "error");
  assert.equal(downloadPhase({ spec, bytes: 10, phase: "starting" }), "downloading", "bytes mean it started");
  assert.deepEqual([undefined, { spec, bytes: 0, phase: "starting" as const }, { spec, bytes: 5, total: 9 }, { spec, bytes: 5, done: true }, { spec, bytes: 0, error: "x" }].map(downloadActive), [false, true, true, false, false]);
});

test("state to buttons and label", () => {
  const m = "managed" as const;
  assert.deepEqual(runtimeButtons({ state: "not-installed", mode: m }), ["install"]);
  assert.deepEqual(runtimeButtons({ state: "installing", mode: m }), []);
  assert.deepEqual(runtimeButtons({ state: "installed", mode: m }), ["turn-on", "remove"]);
  assert.deepEqual(runtimeButtons({ state: "starting", mode: m }), ["turn-off"]);
  assert.deepEqual(runtimeButtons({ state: "running", mode: m }), ["turn-off"]);
  assert.deepEqual(runtimeButtons({ state: "error", mode: m }), ["retry"]);
  assert.deepEqual(runtimeButtons({ state: "unsupported", mode: m }), []);
  assert.deepEqual(runtimeButtons({ state: "running", mode: "external" }), []);
  assert.deepEqual(runtimeButtons({ state: "not-installed", mode: "off" }), []);
  assert.equal(runtimeLabel({ state: "not-installed", mode: "off" }), "Off");
  assert.equal(runtimeLabel({ state: "installing", mode: m, progress: { bytes: 42, total: 100 } }), "Installing 42%");
  assert.equal(runtimeLabel({ state: "not-installed", mode: m }), "Not installed");
});

test("pickerName shortens built-in models only", () => {
  assert.equal(pickerName("llama.cpp", "ggml-org/stories15M_MOE:Q8_0 (built-in)"), "stories15M_MOE:Q8_0");
  assert.equal(pickerName("llama.cpp", "local.gguf (built-in)"), "local.gguf");
  assert.equal(pickerName("anthropic", "org/Model (built-in)"), "org/Model (built-in)");
});
