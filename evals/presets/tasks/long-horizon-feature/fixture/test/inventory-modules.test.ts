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
import * as yard from "../src/inventory/yard.ts";
import * as gate from "../src/inventory/gate.ts";
import * as forklift from "../src/inventory/forklift.ts";
import * as scale from "../src/inventory/scale.ts";
import * as seal from "../src/inventory/seal.ts";
import * as sleeve from "../src/inventory/sleeve.ts";
import * as wrap from "../src/inventory/wrap.ts";
import * as strap from "../src/inventory/strap.ts";
import * as tray from "../src/inventory/tray.ts";
import * as bucket from "../src/inventory/bucket.ts";
import * as drum from "../src/inventory/drum.ts";

test("inventory/warehouse", () => {
  assert.equal(warehouse.warehouseLabel(1), "1 warehouse");
  assert.equal(warehouse.warehouseLabel(3), "3 warehouses");
  assert.equal(warehouse.warehouseSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(warehouse.warehouseSummary({}), "none");
  assert.equal(warehouse.formatWarehouse(" ab1 "), "WAR-AB1");
  assert.equal(warehouse.parseWarehouse("WAR-AB1"), "AB1");
  assert.equal(warehouse.parseWarehouse("zzz"), undefined);
  assert.equal(warehouse.isWarehouseValid(100), true);
  assert.equal(warehouse.isWarehouseValid(101), false);
  assert.equal(warehouse.clampWarehouse(1000), 100);
  assert.equal(warehouse.describeWarehouse("WA01"), "standard warehouse request");
  assert.match(warehouse.describeWarehouse("nope"), /^unknown warehouse code/);
});

test("inventory/bin", () => {
  assert.equal(bin.formatBin(" ab1 "), "BIN-AB1");
  assert.equal(bin.parseBin("BIN-AB1"), "AB1");
  assert.equal(bin.parseBin("zzz"), undefined);
  assert.equal(bin.isBinValid(101), true);
  assert.equal(bin.isBinValid(102), false);
  assert.equal(bin.clampBin(1000), 101);
  assert.equal(bin.binWeight("b"), 3);
  assert.equal(bin.binWeight("z"), 0);
  assert.equal(bin.totalBinWeight(["a", "c", "z"]), 6);
  assert.equal(bin.describeBin("BI01"), "express bin batch");
  assert.match(bin.describeBin("nope"), /^unknown bin code/);
});

test("inventory/shelf", () => {
  assert.equal(shelf.isShelfValid(102), true);
  assert.equal(shelf.isShelfValid(103), false);
  assert.equal(shelf.clampShelf(1000), 102);
  assert.equal(shelf.shelfWeight("b"), 4);
  assert.equal(shelf.shelfWeight("z"), 0);
  assert.equal(shelf.totalShelfWeight(["a", "c", "z"]), 8);
  assert.equal(shelf.shelfScale(10), 40);
  assert.equal(shelf.shelfShare(1, 4), 25);
  assert.equal(shelf.shelfShare(1, 0), 0);
  assert.equal(shelf.describeShelf("SH01"), "fragile shelf policy");
  assert.match(shelf.describeShelf("nope"), /^unknown shelf code/);
});

test("inventory/pallet", () => {
  assert.equal(pallet.palletWeight("b"), 5);
  assert.equal(pallet.palletWeight("z"), 0);
  assert.equal(pallet.totalPalletWeight(["a", "c", "z"]), 10);
  assert.equal(pallet.palletScale(10), 50);
  assert.equal(pallet.palletShare(1, 4), 25);
  assert.equal(pallet.palletShare(1, 0), 0);
  assert.equal(pallet.palletLabel(1), "1 pallet");
  assert.equal(pallet.palletLabel(3), "3 pallets");
  assert.equal(pallet.palletSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(pallet.palletSummary({}), "none");
  assert.equal(pallet.describePallet("PA01"), "bulky pallet ticket");
  assert.match(pallet.describePallet("nope"), /^unknown pallet code/);
});

test("inventory/aisle", () => {
  assert.equal(aisle.aisleScale(10), 60);
  assert.equal(aisle.aisleShare(1, 4), 25);
  assert.equal(aisle.aisleShare(1, 0), 0);
  assert.equal(aisle.aisleLabel(1), "1 aisle");
  assert.equal(aisle.aisleLabel(3), "3 aisles");
  assert.equal(aisle.aisleSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(aisle.aisleSummary({}), "none");
  assert.equal(aisle.formatAisle(" ab1 "), "AIS-AB1");
  assert.equal(aisle.parseAisle("AIS-AB1"), "AB1");
  assert.equal(aisle.parseAisle("zzz"), undefined);
  assert.equal(aisle.describeAisle("AI01"), "seasonal aisle lane");
  assert.match(aisle.describeAisle("nope"), /^unknown aisle code/);
});

test("inventory/zone", () => {
  assert.equal(zone.zoneLabel(1), "1 zone");
  assert.equal(zone.zoneLabel(3), "3 zones");
  assert.equal(zone.zoneSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(zone.zoneSummary({}), "none");
  assert.equal(zone.formatZone(" ab1 "), "ZON-AB1");
  assert.equal(zone.parseZone("ZON-AB1"), "AB1");
  assert.equal(zone.parseZone("zzz"), undefined);
  assert.equal(zone.isZoneValid(105), true);
  assert.equal(zone.isZoneValid(106), false);
  assert.equal(zone.clampZone(1000), 105);
  assert.equal(zone.describeZone("ZO01"), "returnable zone profile");
  assert.match(zone.describeZone("nope"), /^unknown zone code/);
});

test("inventory/dock", () => {
  assert.equal(dock.formatDock(" ab1 "), "DOC-AB1");
  assert.equal(dock.parseDock("DOC-AB1"), "AB1");
  assert.equal(dock.parseDock("zzz"), undefined);
  assert.equal(dock.isDockValid(106), true);
  assert.equal(dock.isDockValid(107), false);
  assert.equal(dock.clampDock(1000), 106);
  assert.equal(dock.dockWeight("b"), 8);
  assert.equal(dock.dockWeight("z"), 0);
  assert.equal(dock.totalDockWeight(["a", "c", "z"]), 16);
  assert.equal(dock.describeDock("DO01"), "perishable dock quota");
  assert.match(dock.describeDock("nope"), /^unknown dock code/);
});

test("inventory/lot", () => {
  assert.equal(lot.isLotValid(107), true);
  assert.equal(lot.isLotValid(108), false);
  assert.equal(lot.clampLot(1000), 107);
  assert.equal(lot.lotWeight("b"), 9);
  assert.equal(lot.lotWeight("z"), 0);
  assert.equal(lot.totalLotWeight(["a", "c", "z"]), 18);
  assert.equal(lot.lotScale(10), 40);
  assert.equal(lot.lotShare(1, 4), 25);
  assert.equal(lot.lotShare(1, 0), 0);
  assert.equal(lot.describeLot("LO01"), "regulated lot session");
  assert.match(lot.describeLot("nope"), /^unknown lot code/);
});

test("inventory/batch", () => {
  assert.equal(batch.batchWeight("b"), 10);
  assert.equal(batch.batchWeight("z"), 0);
  assert.equal(batch.totalBatchWeight(["a", "c", "z"]), 20);
  assert.equal(batch.batchScale(10), 50);
  assert.equal(batch.batchShare(1, 4), 25);
  assert.equal(batch.batchShare(1, 0), 0);
  assert.equal(batch.batchLabel(1), "1 batch");
  assert.equal(batch.batchLabel(3), "3 batchs");
  assert.equal(batch.batchSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(batch.batchSummary({}), "none");
  assert.equal(batch.describeBatch("BA01"), "oversized batch plan");
  assert.match(batch.describeBatch("nope"), /^unknown batch code/);
});

test("inventory/serial", () => {
  assert.equal(serial.serialScale(10), 60);
  assert.equal(serial.serialShare(1, 4), 25);
  assert.equal(serial.serialShare(1, 0), 0);
  assert.equal(serial.serialLabel(1), "1 serial");
  assert.equal(serial.serialLabel(3), "3 serials");
  assert.equal(serial.serialSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(serial.serialSummary({}), "none");
  assert.equal(serial.formatSerial(" ab1 "), "SER-AB1");
  assert.equal(serial.parseSerial("SER-AB1"), "AB1");
  assert.equal(serial.parseSerial("zzz"), undefined);
  assert.equal(serial.describeSerial("SE01"), "premium serial entry");
  assert.match(serial.describeSerial("nope"), /^unknown serial code/);
});

test("inventory/barcode", () => {
  assert.equal(barcode.barcodeLabel(1), "1 barcode");
  assert.equal(barcode.barcodeLabel(3), "3 barcodes");
  assert.equal(barcode.barcodeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(barcode.barcodeSummary({}), "none");
  assert.equal(barcode.formatBarcode(" ab1 "), "BAR-AB1");
  assert.equal(barcode.parseBarcode("BAR-AB1"), "AB1");
  assert.equal(barcode.parseBarcode("zzz"), undefined);
  assert.equal(barcode.isBarcodeValid(110), true);
  assert.equal(barcode.isBarcodeValid(111), false);
  assert.equal(barcode.clampBarcode(1000), 110);
  assert.equal(barcode.describeBarcode("BA01"), "discounted barcode window");
  assert.match(barcode.describeBarcode("nope"), /^unknown barcode code/);
});

test("inventory/label", () => {
  assert.equal(label.formatLabel(" ab1 "), "LAB-AB1");
  assert.equal(label.parseLabel("LAB-AB1"), "AB1");
  assert.equal(label.parseLabel("zzz"), undefined);
  assert.equal(label.isLabelValid(111), true);
  assert.equal(label.isLabelValid(112), false);
  assert.equal(label.clampLabel(1000), 111);
  assert.equal(label.labelWeight("b"), 13);
  assert.equal(label.labelWeight("z"), 0);
  assert.equal(label.totalLabelWeight(["a", "c", "z"]), 26);
  assert.equal(label.describeLabel("LA01"), "limited label check");
  assert.match(label.describeLabel("nope"), /^unknown label code/);
});

test("inventory/carton", () => {
  assert.equal(carton.isCartonValid(112), true);
  assert.equal(carton.isCartonValid(113), false);
  assert.equal(carton.clampCarton(1000), 112);
  assert.equal(carton.cartonWeight("b"), 14);
  assert.equal(carton.cartonWeight("z"), 0);
  assert.equal(carton.totalCartonWeight(["a", "c", "z"]), 28);
  assert.equal(carton.cartonScale(10), 40);
  assert.equal(carton.cartonShare(1, 4), 25);
  assert.equal(carton.cartonShare(1, 0), 0);
  assert.equal(carton.describeCarton("CA01"), "archived carton slot");
  assert.match(carton.describeCarton("nope"), /^unknown carton code/);
});

test("inventory/crate", () => {
  assert.equal(crate.crateWeight("b"), 15);
  assert.equal(crate.crateWeight("z"), 0);
  assert.equal(crate.totalCrateWeight(["a", "c", "z"]), 30);
  assert.equal(crate.crateScale(10), 50);
  assert.equal(crate.crateShare(1, 4), 25);
  assert.equal(crate.crateShare(1, 0), 0);
  assert.equal(crate.crateLabel(1), "1 crate");
  assert.equal(crate.crateLabel(3), "3 crates");
  assert.equal(crate.crateSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(crate.crateSummary({}), "none");
  assert.equal(crate.describeCrate("CR01"), "pending crate group");
  assert.match(crate.describeCrate("nope"), /^unknown crate code/);
});

test("inventory/tote", () => {
  assert.equal(tote.toteScale(10), 60);
  assert.equal(tote.toteShare(1, 4), 25);
  assert.equal(tote.toteShare(1, 0), 0);
  assert.equal(tote.toteLabel(1), "1 tote");
  assert.equal(tote.toteLabel(3), "3 totes");
  assert.equal(tote.toteSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tote.toteSummary({}), "none");
  assert.equal(tote.formatTote(" ab1 "), "TOT-AB1");
  assert.equal(tote.parseTote("TOT-AB1"), "AB1");
  assert.equal(tote.parseTote("zzz"), undefined);
  assert.equal(tote.describeTote("TO01"), "verified tote cap");
  assert.match(tote.describeTote("nope"), /^unknown tote code/);
});

test("inventory/rack", () => {
  assert.equal(rack.rackLabel(1), "1 rack");
  assert.equal(rack.rackLabel(3), "3 racks");
  assert.equal(rack.rackSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(rack.rackSummary({}), "none");
  assert.equal(rack.formatRack(" ab1 "), "RAC-AB1");
  assert.equal(rack.parseRack("RAC-AB1"), "AB1");
  assert.equal(rack.parseRack("zzz"), undefined);
  assert.equal(rack.isRackValid(115), true);
  assert.equal(rack.isRackValid(116), false);
  assert.equal(rack.clampRack(1000), 115);
  assert.equal(rack.describeRack("RA01"), "flagged rack ledger");
  assert.match(rack.describeRack("nope"), /^unknown rack code/);
});

test("inventory/bay", () => {
  assert.equal(bay.formatBay(" ab1 "), "BAY-AB1");
  assert.equal(bay.parseBay("BAY-AB1"), "AB1");
  assert.equal(bay.parseBay("zzz"), undefined);
  assert.equal(bay.isBayValid(116), true);
  assert.equal(bay.isBayValid(117), false);
  assert.equal(bay.clampBay(1000), 116);
  assert.equal(bay.bayWeight("b"), 18);
  assert.equal(bay.bayWeight("z"), 0);
  assert.equal(bay.totalBayWeight(["a", "c", "z"]), 36);
  assert.equal(bay.describeBay("BA01"), "manual bay notice");
  assert.match(bay.describeBay("nope"), /^unknown bay code/);
});

test("inventory/slot", () => {
  assert.equal(slot.isSlotValid(117), true);
  assert.equal(slot.isSlotValid(118), false);
  assert.equal(slot.clampSlot(1000), 117);
  assert.equal(slot.slotWeight("b"), 19);
  assert.equal(slot.slotWeight("z"), 0);
  assert.equal(slot.totalSlotWeight(["a", "c", "z"]), 38);
  assert.equal(slot.slotScale(10), 40);
  assert.equal(slot.slotShare(1, 4), 25);
  assert.equal(slot.slotShare(1, 0), 0);
  assert.equal(slot.describeSlot("SL01"), "automatic slot record");
  assert.match(slot.describeSlot("nope"), /^unknown slot code/);
});

test("inventory/tag", () => {
  assert.equal(tag.tagWeight("b"), 20);
  assert.equal(tag.tagWeight("z"), 0);
  assert.equal(tag.totalTagWeight(["a", "c", "z"]), 40);
  assert.equal(tag.tagScale(10), 50);
  assert.equal(tag.tagShare(1, 4), 25);
  assert.equal(tag.tagShare(1, 0), 0);
  assert.equal(tag.tagLabel(1), "1 tag");
  assert.equal(tag.tagLabel(3), "3 tags");
  assert.equal(tag.tagSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tag.tagSummary({}), "none");
  assert.equal(tag.describeTag("TA01"), "partial tag route");
  assert.match(tag.describeTag("nope"), /^unknown tag code/);
});

test("inventory/scan", () => {
  assert.equal(scan.scanScale(10), 60);
  assert.equal(scan.scanShare(1, 4), 25);
  assert.equal(scan.scanShare(1, 0), 0);
  assert.equal(scan.scanLabel(1), "1 scan");
  assert.equal(scan.scanLabel(3), "3 scans");
  assert.equal(scan.scanSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(scan.scanSummary({}), "none");
  assert.equal(scan.formatScan(" ab1 "), "SCA-AB1");
  assert.equal(scan.parseScan("SCA-AB1"), "AB1");
  assert.equal(scan.parseScan("zzz"), undefined);
  assert.equal(scan.describeScan("SC01"), "primary scan rule");
  assert.match(scan.describeScan("nope"), /^unknown scan code/);
});

test("inventory/count", () => {
  assert.equal(count.countLabel(1), "1 count");
  assert.equal(count.countLabel(3), "3 counts");
  assert.equal(count.countSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(count.countSummary({}), "none");
  assert.equal(count.formatCount(" ab1 "), "COU-AB1");
  assert.equal(count.parseCount("COU-AB1"), "AB1");
  assert.equal(count.parseCount("zzz"), undefined);
  assert.equal(count.isCountValid(120), true);
  assert.equal(count.isCountValid(121), false);
  assert.equal(count.clampCount(1000), 120);
  assert.equal(count.describeCount("CO01"), "secondary count queue");
  assert.match(count.describeCount("nope"), /^unknown count code/);
});

test("inventory/audit", () => {
  assert.equal(audit.formatAudit(" ab1 "), "AUD-AB1");
  assert.equal(audit.parseAudit("AUD-AB1"), "AB1");
  assert.equal(audit.parseAudit("zzz"), undefined);
  assert.equal(audit.isAuditValid(121), true);
  assert.equal(audit.isAuditValid(122), false);
  assert.equal(audit.clampAudit(1000), 121);
  assert.equal(audit.auditWeight("b"), 23);
  assert.equal(audit.auditWeight("z"), 0);
  assert.equal(audit.totalAuditWeight(["a", "c", "z"]), 46);
  assert.equal(audit.describeAudit("AU01"), "legacy audit tier");
  assert.match(audit.describeAudit("nope"), /^unknown audit code/);
});

test("inventory/cycle", () => {
  assert.equal(cycle.isCycleValid(122), true);
  assert.equal(cycle.isCycleValid(123), false);
  assert.equal(cycle.clampCycle(1000), 122);
  assert.equal(cycle.cycleWeight("b"), 24);
  assert.equal(cycle.cycleWeight("z"), 0);
  assert.equal(cycle.totalCycleWeight(["a", "c", "z"]), 48);
  assert.equal(cycle.cycleScale(10), 40);
  assert.equal(cycle.cycleShare(1, 4), 25);
  assert.equal(cycle.cycleShare(1, 0), 0);
  assert.equal(cycle.describeCycle("CY01"), "trial cycle rate");
  assert.match(cycle.describeCycle("nope"), /^unknown cycle code/);
});

test("inventory/putaway", () => {
  assert.equal(putaway.putawayWeight("b"), 25);
  assert.equal(putaway.putawayWeight("z"), 0);
  assert.equal(putaway.totalPutawayWeight(["a", "c", "z"]), 50);
  assert.equal(putaway.putawayScale(10), 50);
  assert.equal(putaway.putawayShare(1, 4), 25);
  assert.equal(putaway.putawayShare(1, 0), 0);
  assert.equal(putaway.putawayLabel(1), "1 putaway");
  assert.equal(putaway.putawayLabel(3), "3 putaways");
  assert.equal(putaway.putawaySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(putaway.putawaySummary({}), "none");
  assert.equal(putaway.describePutaway("PU01"), "internal putaway cycle");
  assert.match(putaway.describePutaway("nope"), /^unknown putaway code/);
});

test("inventory/pick", () => {
  assert.equal(pick.pickScale(10), 60);
  assert.equal(pick.pickShare(1, 4), 25);
  assert.equal(pick.pickShare(1, 0), 0);
  assert.equal(pick.pickLabel(1), "1 pick");
  assert.equal(pick.pickLabel(3), "3 picks");
  assert.equal(pick.pickSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(pick.pickSummary({}), "none");
  assert.equal(pick.formatPick(" ab1 "), "PIC-AB1");
  assert.equal(pick.parsePick("PIC-AB1"), "AB1");
  assert.equal(pick.parsePick("zzz"), undefined);
  assert.equal(pick.describePick("PI01"), "external pick contact");
  assert.match(pick.describePick("nope"), /^unknown pick code/);
});

test("inventory/pack", () => {
  assert.equal(pack.packLabel(1), "1 pack");
  assert.equal(pack.packLabel(3), "3 packs");
  assert.equal(pack.packSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(pack.packSummary({}), "none");
  assert.equal(pack.formatPack(" ab1 "), "PAC-AB1");
  assert.equal(pack.parsePack("PAC-AB1"), "AB1");
  assert.equal(pack.parsePack("zzz"), undefined);
  assert.equal(pack.isPackValid(125), true);
  assert.equal(pack.isPackValid(126), false);
  assert.equal(pack.clampPack(1000), 125);
  assert.equal(pack.describePack("PA01"), "priority pack request");
  assert.match(pack.describePack("nope"), /^unknown pack code/);
});

test("inventory/ship", () => {
  assert.equal(ship.formatShip(" ab1 "), "SHI-AB1");
  assert.equal(ship.parseShip("SHI-AB1"), "AB1");
  assert.equal(ship.parseShip("zzz"), undefined);
  assert.equal(ship.isShipValid(126), true);
  assert.equal(ship.isShipValid(127), false);
  assert.equal(ship.clampShip(1000), 126);
  assert.equal(ship.shipWeight("b"), 28);
  assert.equal(ship.shipWeight("z"), 0);
  assert.equal(ship.totalShipWeight(["a", "c", "z"]), 56);
  assert.equal(ship.describeShip("SH01"), "deferred ship batch");
  assert.match(ship.describeShip("nope"), /^unknown ship code/);
});

test("inventory/restock", () => {
  assert.equal(restock.isRestockValid(127), true);
  assert.equal(restock.isRestockValid(128), false);
  assert.equal(restock.clampRestock(1000), 127);
  assert.equal(restock.restockWeight("b"), 29);
  assert.equal(restock.restockWeight("z"), 0);
  assert.equal(restock.totalRestockWeight(["a", "c", "z"]), 58);
  assert.equal(restock.restockScale(10), 40);
  assert.equal(restock.restockShare(1, 4), 25);
  assert.equal(restock.restockShare(1, 0), 0);
  assert.equal(restock.describeRestock("RE01"), "standard restock policy");
  assert.match(restock.describeRestock("nope"), /^unknown restock code/);
});

test("inventory/damage", () => {
  assert.equal(damage.damageWeight("b"), 30);
  assert.equal(damage.damageWeight("z"), 0);
  assert.equal(damage.totalDamageWeight(["a", "c", "z"]), 60);
  assert.equal(damage.damageScale(10), 50);
  assert.equal(damage.damageShare(1, 4), 25);
  assert.equal(damage.damageShare(1, 0), 0);
  assert.equal(damage.damageLabel(1), "1 damage");
  assert.equal(damage.damageLabel(3), "3 damages");
  assert.equal(damage.damageSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(damage.damageSummary({}), "none");
  assert.equal(damage.describeDamage("DA01"), "express damage ticket");
  assert.match(damage.describeDamage("nope"), /^unknown damage code/);
});

test("inventory/expiry", () => {
  assert.equal(expiry.expiryScale(10), 60);
  assert.equal(expiry.expiryShare(1, 4), 25);
  assert.equal(expiry.expiryShare(1, 0), 0);
  assert.equal(expiry.expiryLabel(1), "1 expiry");
  assert.equal(expiry.expiryLabel(3), "3 expirys");
  assert.equal(expiry.expirySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(expiry.expirySummary({}), "none");
  assert.equal(expiry.formatExpiry(" ab1 "), "EXP-AB1");
  assert.equal(expiry.parseExpiry("EXP-AB1"), "AB1");
  assert.equal(expiry.parseExpiry("zzz"), undefined);
  assert.equal(expiry.describeExpiry("EX01"), "fragile expiry lane");
  assert.match(expiry.describeExpiry("nope"), /^unknown expiry code/);
});

test("inventory/recall", () => {
  assert.equal(recall.recallLabel(1), "1 recall");
  assert.equal(recall.recallLabel(3), "3 recalls");
  assert.equal(recall.recallSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(recall.recallSummary({}), "none");
  assert.equal(recall.formatRecall(" ab1 "), "REC-AB1");
  assert.equal(recall.parseRecall("REC-AB1"), "AB1");
  assert.equal(recall.parseRecall("zzz"), undefined);
  assert.equal(recall.isRecallValid(130), true);
  assert.equal(recall.isRecallValid(131), false);
  assert.equal(recall.clampRecall(1000), 130);
  assert.equal(recall.describeRecall("RE01"), "bulky recall profile");
  assert.match(recall.describeRecall("nope"), /^unknown recall code/);
});

test("inventory/transfer", () => {
  assert.equal(transfer.formatTransfer(" ab1 "), "TRA-AB1");
  assert.equal(transfer.parseTransfer("TRA-AB1"), "AB1");
  assert.equal(transfer.parseTransfer("zzz"), undefined);
  assert.equal(transfer.isTransferValid(131), true);
  assert.equal(transfer.isTransferValid(132), false);
  assert.equal(transfer.clampTransfer(1000), 131);
  assert.equal(transfer.transferWeight("b"), 33);
  assert.equal(transfer.transferWeight("z"), 0);
  assert.equal(transfer.totalTransferWeight(["a", "c", "z"]), 66);
  assert.equal(transfer.describeTransfer("TR01"), "seasonal transfer quota");
  assert.match(transfer.describeTransfer("nope"), /^unknown transfer code/);
});

test("inventory/yard", () => {
  assert.equal(yard.isYardValid(132), true);
  assert.equal(yard.isYardValid(133), false);
  assert.equal(yard.clampYard(1000), 132);
  assert.equal(yard.yardWeight("b"), 34);
  assert.equal(yard.yardWeight("z"), 0);
  assert.equal(yard.totalYardWeight(["a", "c", "z"]), 68);
  assert.equal(yard.yardScale(10), 40);
  assert.equal(yard.yardShare(1, 4), 25);
  assert.equal(yard.yardShare(1, 0), 0);
  assert.equal(yard.describeYard("YA01"), "returnable yard session");
  assert.match(yard.describeYard("nope"), /^unknown yard code/);
});

test("inventory/gate", () => {
  assert.equal(gate.gateWeight("b"), 35);
  assert.equal(gate.gateWeight("z"), 0);
  assert.equal(gate.totalGateWeight(["a", "c", "z"]), 70);
  assert.equal(gate.gateScale(10), 50);
  assert.equal(gate.gateShare(1, 4), 25);
  assert.equal(gate.gateShare(1, 0), 0);
  assert.equal(gate.gateLabel(1), "1 gate");
  assert.equal(gate.gateLabel(3), "3 gates");
  assert.equal(gate.gateSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(gate.gateSummary({}), "none");
  assert.equal(gate.describeGate("GA01"), "perishable gate plan");
  assert.match(gate.describeGate("nope"), /^unknown gate code/);
});

test("inventory/forklift", () => {
  assert.equal(forklift.forkliftScale(10), 60);
  assert.equal(forklift.forkliftShare(1, 4), 25);
  assert.equal(forklift.forkliftShare(1, 0), 0);
  assert.equal(forklift.forkliftLabel(1), "1 forklift");
  assert.equal(forklift.forkliftLabel(3), "3 forklifts");
  assert.equal(forklift.forkliftSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(forklift.forkliftSummary({}), "none");
  assert.equal(forklift.formatForklift(" ab1 "), "FOR-AB1");
  assert.equal(forklift.parseForklift("FOR-AB1"), "AB1");
  assert.equal(forklift.parseForklift("zzz"), undefined);
  assert.equal(forklift.describeForklift("FO01"), "regulated forklift entry");
  assert.match(forklift.describeForklift("nope"), /^unknown forklift code/);
});

test("inventory/scale", () => {
  assert.equal(scale.scaleLabel(1), "1 scale");
  assert.equal(scale.scaleLabel(3), "3 scales");
  assert.equal(scale.scaleSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(scale.scaleSummary({}), "none");
  assert.equal(scale.formatScale(" ab1 "), "SCA-AB1");
  assert.equal(scale.parseScale("SCA-AB1"), "AB1");
  assert.equal(scale.parseScale("zzz"), undefined);
  assert.equal(scale.isScaleValid(135), true);
  assert.equal(scale.isScaleValid(136), false);
  assert.equal(scale.clampScale(1000), 135);
  assert.equal(scale.describeScale("SC01"), "oversized scale window");
  assert.match(scale.describeScale("nope"), /^unknown scale code/);
});

test("inventory/seal", () => {
  assert.equal(seal.formatSeal(" ab1 "), "SEA-AB1");
  assert.equal(seal.parseSeal("SEA-AB1"), "AB1");
  assert.equal(seal.parseSeal("zzz"), undefined);
  assert.equal(seal.isSealValid(136), true);
  assert.equal(seal.isSealValid(137), false);
  assert.equal(seal.clampSeal(1000), 136);
  assert.equal(seal.sealWeight("b"), 38);
  assert.equal(seal.sealWeight("z"), 0);
  assert.equal(seal.totalSealWeight(["a", "c", "z"]), 76);
  assert.equal(seal.describeSeal("SE01"), "premium seal check");
  assert.match(seal.describeSeal("nope"), /^unknown seal code/);
});

test("inventory/sleeve", () => {
  assert.equal(sleeve.isSleeveValid(137), true);
  assert.equal(sleeve.isSleeveValid(138), false);
  assert.equal(sleeve.clampSleeve(1000), 137);
  assert.equal(sleeve.sleeveWeight("b"), 39);
  assert.equal(sleeve.sleeveWeight("z"), 0);
  assert.equal(sleeve.totalSleeveWeight(["a", "c", "z"]), 78);
  assert.equal(sleeve.sleeveScale(10), 40);
  assert.equal(sleeve.sleeveShare(1, 4), 25);
  assert.equal(sleeve.sleeveShare(1, 0), 0);
  assert.equal(sleeve.describeSleeve("SL01"), "discounted sleeve slot");
  assert.match(sleeve.describeSleeve("nope"), /^unknown sleeve code/);
});

test("inventory/wrap", () => {
  assert.equal(wrap.wrapWeight("b"), 40);
  assert.equal(wrap.wrapWeight("z"), 0);
  assert.equal(wrap.totalWrapWeight(["a", "c", "z"]), 80);
  assert.equal(wrap.wrapScale(10), 50);
  assert.equal(wrap.wrapShare(1, 4), 25);
  assert.equal(wrap.wrapShare(1, 0), 0);
  assert.equal(wrap.wrapLabel(1), "1 wrap");
  assert.equal(wrap.wrapLabel(3), "3 wraps");
  assert.equal(wrap.wrapSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(wrap.wrapSummary({}), "none");
  assert.equal(wrap.describeWrap("WR01"), "limited wrap group");
  assert.match(wrap.describeWrap("nope"), /^unknown wrap code/);
});

test("inventory/strap", () => {
  assert.equal(strap.strapScale(10), 60);
  assert.equal(strap.strapShare(1, 4), 25);
  assert.equal(strap.strapShare(1, 0), 0);
  assert.equal(strap.strapLabel(1), "1 strap");
  assert.equal(strap.strapLabel(3), "3 straps");
  assert.equal(strap.strapSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(strap.strapSummary({}), "none");
  assert.equal(strap.formatStrap(" ab1 "), "STR-AB1");
  assert.equal(strap.parseStrap("STR-AB1"), "AB1");
  assert.equal(strap.parseStrap("zzz"), undefined);
  assert.equal(strap.describeStrap("ST01"), "archived strap cap");
  assert.match(strap.describeStrap("nope"), /^unknown strap code/);
});

test("inventory/tray", () => {
  assert.equal(tray.trayLabel(1), "1 tray");
  assert.equal(tray.trayLabel(3), "3 trays");
  assert.equal(tray.traySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tray.traySummary({}), "none");
  assert.equal(tray.formatTray(" ab1 "), "TRA-AB1");
  assert.equal(tray.parseTray("TRA-AB1"), "AB1");
  assert.equal(tray.parseTray("zzz"), undefined);
  assert.equal(tray.isTrayValid(140), true);
  assert.equal(tray.isTrayValid(141), false);
  assert.equal(tray.clampTray(1000), 140);
  assert.equal(tray.describeTray("TR01"), "pending tray ledger");
  assert.match(tray.describeTray("nope"), /^unknown tray code/);
});

test("inventory/bucket", () => {
  assert.equal(bucket.formatBucket(" ab1 "), "BUC-AB1");
  assert.equal(bucket.parseBucket("BUC-AB1"), "AB1");
  assert.equal(bucket.parseBucket("zzz"), undefined);
  assert.equal(bucket.isBucketValid(141), true);
  assert.equal(bucket.isBucketValid(142), false);
  assert.equal(bucket.clampBucket(1000), 141);
  assert.equal(bucket.bucketWeight("b"), 43);
  assert.equal(bucket.bucketWeight("z"), 0);
  assert.equal(bucket.totalBucketWeight(["a", "c", "z"]), 86);
  assert.equal(bucket.describeBucket("BU01"), "verified bucket notice");
  assert.match(bucket.describeBucket("nope"), /^unknown bucket code/);
});

test("inventory/drum", () => {
  assert.equal(drum.isDrumValid(142), true);
  assert.equal(drum.isDrumValid(143), false);
  assert.equal(drum.clampDrum(1000), 142);
  assert.equal(drum.drumWeight("b"), 44);
  assert.equal(drum.drumWeight("z"), 0);
  assert.equal(drum.totalDrumWeight(["a", "c", "z"]), 88);
  assert.equal(drum.drumScale(10), 40);
  assert.equal(drum.drumShare(1, 4), 25);
  assert.equal(drum.drumShare(1, 0), 0);
  assert.equal(drum.describeDrum("DR01"), "flagged drum record");
  assert.match(drum.describeDrum("nope"), /^unknown drum code/);
});
