import assert from "node:assert/strict";
import { test } from "node:test";
import * as daily from "../src/reports/daily.ts";
import * as weekly from "../src/reports/weekly.ts";
import * as monthly from "../src/reports/monthly.ts";
import * as quarterly from "../src/reports/quarterly.ts";
import * as yearly from "../src/reports/yearly.ts";
import * as cohort from "../src/reports/cohort.ts";
import * as funnel from "../src/reports/funnel.ts";
import * as churn from "../src/reports/churn.ts";
import * as retention from "../src/reports/retention.ts";
import * as margin from "../src/reports/margin.ts";
import * as revenue from "../src/reports/revenue.ts";
import * as cost from "../src/reports/cost.ts";
import * as basket from "../src/reports/basket.ts";
import * as average from "../src/reports/average.ts";
import * as median from "../src/reports/median.ts";
import * as percentile from "../src/reports/percentile.ts";
import * as trend from "../src/reports/trend.ts";
import * as forecast from "../src/reports/forecast.ts";
import * as anomaly from "../src/reports/anomaly.ts";
import * as segment from "../src/reports/segment.ts";
import * as region from "../src/reports/region.ts";
import * as category from "../src/reports/category.ts";
import * as brand from "../src/reports/brand.ts";
import * as supplier from "../src/reports/supplier.ts";
import * as staff from "../src/reports/staff.ts";
import * as shift from "../src/reports/shift.ts";
import * as coverage from "../src/reports/coverage.ts";
import * as backlog from "../src/reports/backlog.ts";
import * as aging from "../src/reports/aging.ts";
import * as turnover from "../src/reports/turnover.ts";
import * as extract from "../src/reports/extract.ts";
import * as snapshot from "../src/reports/snapshot.ts";

test("reports/daily", () => {
  assert.equal(daily.dailyWeight("b"), 2);
  assert.equal(daily.dailyWeight("z"), 0);
});

test("reports/weekly", () => {
  assert.equal(weekly.weeklyScale(10), 30);
});

test("reports/monthly", () => {
  assert.equal(monthly.monthlyLabel(1), "1 monthly");
  assert.equal(monthly.monthlyLabel(3), "3 monthlys");
});

test("reports/quarterly", () => {
  assert.equal(quarterly.formatQuarterly(" ab1 "), "QUA-AB1");
});

test("reports/yearly", () => {
  assert.equal(yearly.isYearlyValid(104), true);
  assert.equal(yearly.isYearlyValid(105), false);
});

test("reports/cohort", () => {
  assert.equal(cohort.cohortWeight("b"), 7);
  assert.equal(cohort.cohortWeight("z"), 0);
});

test("reports/funnel", () => {
  assert.equal(funnel.funnelScale(10), 30);
});

test("reports/churn", () => {
  assert.equal(churn.churnLabel(1), "1 churn");
  assert.equal(churn.churnLabel(3), "3 churns");
});

test("reports/retention", () => {
  assert.equal(retention.formatRetention(" ab1 "), "RET-AB1");
});

test("reports/margin", () => {
  assert.equal(margin.isMarginValid(109), true);
  assert.equal(margin.isMarginValid(110), false);
});

test("reports/revenue", () => {
  assert.equal(revenue.revenueWeight("b"), 12);
  assert.equal(revenue.revenueWeight("z"), 0);
});

test("reports/cost", () => {
  assert.equal(cost.costScale(10), 30);
});

test("reports/basket", () => {
  assert.equal(basket.basketLabel(1), "1 basket");
  assert.equal(basket.basketLabel(3), "3 baskets");
});

test("reports/average", () => {
  assert.equal(average.formatAverage(" ab1 "), "AVE-AB1");
});

test("reports/median", () => {
  assert.equal(median.isMedianValid(114), true);
  assert.equal(median.isMedianValid(115), false);
});

test("reports/percentile", () => {
  assert.equal(percentile.percentileWeight("b"), 17);
  assert.equal(percentile.percentileWeight("z"), 0);
});

test("reports/trend", () => {
  assert.equal(trend.trendScale(10), 30);
});

test("reports/forecast", () => {
  assert.equal(forecast.forecastLabel(1), "1 forecast");
  assert.equal(forecast.forecastLabel(3), "3 forecasts");
});

test("reports/anomaly", () => {
  assert.equal(anomaly.formatAnomaly(" ab1 "), "ANO-AB1");
});

test("reports/segment", () => {
  assert.equal(segment.isSegmentValid(119), true);
  assert.equal(segment.isSegmentValid(120), false);
});

test("reports/region", () => {
  assert.equal(region.regionWeight("b"), 22);
  assert.equal(region.regionWeight("z"), 0);
});

test("reports/category", () => {
  assert.equal(category.categoryScale(10), 30);
});

test("reports/brand", () => {
  assert.equal(brand.brandLabel(1), "1 brand");
  assert.equal(brand.brandLabel(3), "3 brands");
});

test("reports/supplier", () => {
  assert.equal(supplier.formatSupplier(" ab1 "), "SUP-AB1");
});

test("reports/staff", () => {
  assert.equal(staff.isStaffValid(124), true);
  assert.equal(staff.isStaffValid(125), false);
});

test("reports/shift", () => {
  assert.equal(shift.shiftWeight("b"), 27);
  assert.equal(shift.shiftWeight("z"), 0);
});

test("reports/coverage", () => {
  assert.equal(coverage.coverageScale(10), 30);
});

test("reports/backlog", () => {
  assert.equal(backlog.backlogLabel(1), "1 backlog");
  assert.equal(backlog.backlogLabel(3), "3 backlogs");
});

test("reports/aging", () => {
  assert.equal(aging.formatAging(" ab1 "), "AGI-AB1");
});

test("reports/turnover", () => {
  assert.equal(turnover.isTurnoverValid(129), true);
  assert.equal(turnover.isTurnoverValid(130), false);
});

test("reports/extract", () => {
  assert.equal(extract.extractWeight("b"), 32);
  assert.equal(extract.extractWeight("z"), 0);
});

test("reports/snapshot", () => {
  assert.equal(snapshot.snapshotScale(10), 30);
});
