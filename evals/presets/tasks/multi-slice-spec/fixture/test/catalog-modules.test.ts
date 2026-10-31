import assert from "node:assert/strict";
import { test } from "node:test";
import * as category from "../src/catalog/category.ts";
import * as brand from "../src/catalog/brand.ts";
import * as variant from "../src/catalog/variant.ts";
import * as option from "../src/catalog/option.ts";
import * as size from "../src/catalog/size.ts";
import * as color from "../src/catalog/color.ts";
import * as material from "../src/catalog/material.ts";
import * as season from "../src/catalog/season.ts";
import * as collection from "../src/catalog/collection.ts";
import * as badge from "../src/catalog/badge.ts";
import * as rating from "../src/catalog/rating.ts";
import * as review from "../src/catalog/review.ts";
import * as image from "../src/catalog/image.ts";
import * as gallery from "../src/catalog/gallery.ts";

test("catalog/category", () => {
  assert.equal(category.categoryWeight("b"), 2);
  assert.equal(category.categoryWeight("z"), 0);
});

test("catalog/brand", () => {
  assert.equal(brand.brandScale(10), 30);
});

test("catalog/variant", () => {
  assert.equal(variant.variantLabel(1), "1 variant");
  assert.equal(variant.variantLabel(3), "3 variants");
});

test("catalog/option", () => {
  assert.equal(option.formatOption(" ab1 "), "OPT-AB1");
});

test("catalog/size", () => {
  assert.equal(size.isSizeValid(104), true);
  assert.equal(size.isSizeValid(105), false);
});

test("catalog/color", () => {
  assert.equal(color.colorWeight("b"), 7);
  assert.equal(color.colorWeight("z"), 0);
});

test("catalog/material", () => {
  assert.equal(material.materialScale(10), 30);
});

test("catalog/season", () => {
  assert.equal(season.seasonLabel(1), "1 season");
  assert.equal(season.seasonLabel(3), "3 seasons");
});

test("catalog/collection", () => {
  assert.equal(collection.formatCollection(" ab1 "), "COL-AB1");
});

test("catalog/badge", () => {
  assert.equal(badge.isBadgeValid(109), true);
  assert.equal(badge.isBadgeValid(110), false);
});

test("catalog/rating", () => {
  assert.equal(rating.ratingWeight("b"), 12);
  assert.equal(rating.ratingWeight("z"), 0);
});

test("catalog/review", () => {
  assert.equal(review.reviewScale(10), 30);
});

test("catalog/image", () => {
  assert.equal(image.imageLabel(1), "1 image");
  assert.equal(image.imageLabel(3), "3 images");
});

test("catalog/gallery", () => {
  assert.equal(gallery.formatGallery(" ab1 "), "GAL-AB1");
});
