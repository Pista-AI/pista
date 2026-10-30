import assert from "node:assert/strict";
import { test } from "node:test";
import * as warehouse from "../src/inventory/warehouse.ts";
import * as bin from "../src/inventory/bin.ts";
import * as shelf from "../src/inventory/shelf.ts";
import * as pallet from "../src/inventory/pallet.ts";
import * as aisle from "../src/inventory/aisle.ts";
import * as zone from "../src/inventory/zone.ts";
import * as dock from "../src/inventory/dock.ts";
import * as lot from "../src/inventory/lot.ts";
import * as batch from "../src/inventory/batch.ts";
import * as serial from "../src/inventory/serial.ts";
import * as barcode from "../src/inventory/barcode.ts";
import * as label from "../src/inventory/label.ts";
import * as carton from "../src/inventory/carton.ts";
import * as crate from "../src/inventory/crate.ts";
import * as tote from "../src/inventory/tote.ts";
import * as rack from "../src/inventory/rack.ts";
import * as bay from "../src/inventory/bay.ts";
import * as slot from "../src/inventory/slot.ts";
import * as tag from "../src/inventory/tag.ts";
import * as scan from "../src/inventory/scan.ts";
import * as count from "../src/inventory/count.ts";
import * as audit from "../src/inventory/audit.ts";
import * as cycle from "../src/inventory/cycle.ts";
import * as putaway from "../src/inventory/putaway.ts";
import * as pick from "../src/inventory/pick.ts";
import * as pack from "../src/inventory/pack.ts";
import * as ship from "../src/inventory/ship.ts";
import * as restock from "../src/inventory/restock.ts";
import * as damage from "../src/inventory/damage.ts";
import * as expiry from "../src/inventory/expiry.ts";
import * as recall from "../src/inventory/recall.ts";
import * as transfer from "../src/inventory/transfer.ts";

test("inventory/warehouse", () => {
  assert.equal(warehouse.warehouseLabel(1), "1 warehouse");
  assert.equal(warehouse.warehouseLabel(3), "3 warehouses");
});

test("inventory/bin", () => {
  assert.equal(bin.formatBin(" ab1 "), "BIN-AB1");
});

test("inventory/shelf", () => {
  assert.equal(shelf.isShelfValid(102), true);
  assert.equal(shelf.isShelfValid(103), false);
});

test("inventory/pallet", () => {
  assert.equal(pallet.palletWeight("b"), 5);
  assert.equal(pallet.palletWeight("z"), 0);
});

test("inventory/aisle", () => {
  assert.equal(aisle.aisleScale(10), 60);
});

test("inventory/zone", () => {
  assert.equal(zone.zoneLabel(1), "1 zone");
  assert.equal(zone.zoneLabel(3), "3 zones");
});

test("inventory/dock", () => {
  assert.equal(dock.formatDock(" ab1 "), "DOC-AB1");
});

test("inventory/lot", () => {
  assert.equal(lot.isLotValid(107), true);
  assert.equal(lot.isLotValid(108), false);
});

test("inventory/batch", () => {
  assert.equal(batch.batchWeight("b"), 10);
  assert.equal(batch.batchWeight("z"), 0);
});

test("inventory/serial", () => {
  assert.equal(serial.serialScale(10), 60);
});

test("inventory/barcode", () => {
  assert.equal(barcode.barcodeLabel(1), "1 barcode");
  assert.equal(barcode.barcodeLabel(3), "3 barcodes");
});

test("inventory/label", () => {
  assert.equal(label.formatLabel(" ab1 "), "LAB-AB1");
});

test("inventory/carton", () => {
  assert.equal(carton.isCartonValid(112), true);
  assert.equal(carton.isCartonValid(113), false);
});

test("inventory/crate", () => {
  assert.equal(crate.crateWeight("b"), 15);
  assert.equal(crate.crateWeight("z"), 0);
});

test("inventory/tote", () => {
  assert.equal(tote.toteScale(10), 60);
});

test("inventory/rack", () => {
  assert.equal(rack.rackLabel(1), "1 rack");
  assert.equal(rack.rackLabel(3), "3 racks");
});

test("inventory/bay", () => {
  assert.equal(bay.formatBay(" ab1 "), "BAY-AB1");
});

test("inventory/slot", () => {
  assert.equal(slot.isSlotValid(117), true);
  assert.equal(slot.isSlotValid(118), false);
});

test("inventory/tag", () => {
  assert.equal(tag.tagWeight("b"), 20);
  assert.equal(tag.tagWeight("z"), 0);
});

test("inventory/scan", () => {
  assert.equal(scan.scanScale(10), 60);
});

test("inventory/count", () => {
  assert.equal(count.countLabel(1), "1 count");
  assert.equal(count.countLabel(3), "3 counts");
});

test("inventory/audit", () => {
  assert.equal(audit.formatAudit(" ab1 "), "AUD-AB1");
});

test("inventory/cycle", () => {
  assert.equal(cycle.isCycleValid(122), true);
  assert.equal(cycle.isCycleValid(123), false);
});

test("inventory/putaway", () => {
  assert.equal(putaway.putawayWeight("b"), 25);
  assert.equal(putaway.putawayWeight("z"), 0);
});

test("inventory/pick", () => {
  assert.equal(pick.pickScale(10), 60);
});

test("inventory/pack", () => {
  assert.equal(pack.packLabel(1), "1 pack");
  assert.equal(pack.packLabel(3), "3 packs");
});

test("inventory/ship", () => {
  assert.equal(ship.formatShip(" ab1 "), "SHI-AB1");
});

test("inventory/restock", () => {
  assert.equal(restock.isRestockValid(127), true);
  assert.equal(restock.isRestockValid(128), false);
});

test("inventory/damage", () => {
  assert.equal(damage.damageWeight("b"), 30);
  assert.equal(damage.damageWeight("z"), 0);
});

test("inventory/expiry", () => {
  assert.equal(expiry.expiryScale(10), 60);
});

test("inventory/recall", () => {
  assert.equal(recall.recallLabel(1), "1 recall");
  assert.equal(recall.recallLabel(3), "3 recalls");
});

test("inventory/transfer", () => {
  assert.equal(transfer.formatTransfer(" ab1 "), "TRA-AB1");
});
