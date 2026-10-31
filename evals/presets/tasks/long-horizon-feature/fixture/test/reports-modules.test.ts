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
import * as rollup from "../src/reports/rollup.ts";
import * as pivot from "../src/reports/pivot.ts";
import * as bucket from "../src/reports/bucket.ts";
import * as windowAvg from "../src/reports/window-avg.ts";
import * as outlier from "../src/reports/outlier.ts";
import * as rank from "../src/reports/rank.ts";

test("reports/daily", () => {
  assert.equal(daily.dailyWeight("b"), 2);
  assert.equal(daily.dailyWeight("z"), 0);
  assert.equal(daily.totalDailyWeight(["a", "c", "z"]), 4);
  assert.equal(daily.dailyScale(10), 20);
  assert.equal(daily.dailyShare(1, 4), 25);
  assert.equal(daily.dailyShare(1, 0), 0);
  assert.equal(daily.dailyLabel(1), "1 daily");
  assert.equal(daily.dailyLabel(3), "3 dailys");
  assert.equal(daily.dailySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(daily.dailySummary({}), "none");
  assert.equal(daily.describeDaily("DA01"), "standard daily request");
  assert.match(daily.describeDaily("nope"), /^unknown daily code/);
});

test("reports/weekly", () => {
  assert.equal(weekly.weeklyScale(10), 30);
  assert.equal(weekly.weeklyShare(1, 4), 25);
  assert.equal(weekly.weeklyShare(1, 0), 0);
  assert.equal(weekly.weeklyLabel(1), "1 weekly");
  assert.equal(weekly.weeklyLabel(3), "3 weeklys");
  assert.equal(weekly.weeklySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(weekly.weeklySummary({}), "none");
  assert.equal(weekly.formatWeekly(" ab1 "), "WEE-AB1");
  assert.equal(weekly.parseWeekly("WEE-AB1"), "AB1");
  assert.equal(weekly.parseWeekly("zzz"), undefined);
  assert.equal(weekly.describeWeekly("WE01"), "express weekly batch");
  assert.match(weekly.describeWeekly("nope"), /^unknown weekly code/);
});

test("reports/monthly", () => {
  assert.equal(monthly.monthlyLabel(1), "1 monthly");
  assert.equal(monthly.monthlyLabel(3), "3 monthlys");
  assert.equal(monthly.monthlySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(monthly.monthlySummary({}), "none");
  assert.equal(monthly.formatMonthly(" ab1 "), "MON-AB1");
  assert.equal(monthly.parseMonthly("MON-AB1"), "AB1");
  assert.equal(monthly.parseMonthly("zzz"), undefined);
  assert.equal(monthly.isMonthlyValid(102), true);
  assert.equal(monthly.isMonthlyValid(103), false);
  assert.equal(monthly.clampMonthly(1000), 102);
  assert.equal(monthly.describeMonthly("MO01"), "fragile monthly policy");
  assert.match(monthly.describeMonthly("nope"), /^unknown monthly code/);
});

test("reports/quarterly", () => {
  assert.equal(quarterly.formatQuarterly(" ab1 "), "QUA-AB1");
  assert.equal(quarterly.parseQuarterly("QUA-AB1"), "AB1");
  assert.equal(quarterly.parseQuarterly("zzz"), undefined);
  assert.equal(quarterly.isQuarterlyValid(103), true);
  assert.equal(quarterly.isQuarterlyValid(104), false);
  assert.equal(quarterly.clampQuarterly(1000), 103);
  assert.equal(quarterly.quarterlyWeight("b"), 5);
  assert.equal(quarterly.quarterlyWeight("z"), 0);
  assert.equal(quarterly.totalQuarterlyWeight(["a", "c", "z"]), 10);
  assert.equal(quarterly.describeQuarterly("QU01"), "bulky quarterly ticket");
  assert.match(quarterly.describeQuarterly("nope"), /^unknown quarterly code/);
});

test("reports/yearly", () => {
  assert.equal(yearly.isYearlyValid(104), true);
  assert.equal(yearly.isYearlyValid(105), false);
  assert.equal(yearly.clampYearly(1000), 104);
  assert.equal(yearly.yearlyWeight("b"), 6);
  assert.equal(yearly.yearlyWeight("z"), 0);
  assert.equal(yearly.totalYearlyWeight(["a", "c", "z"]), 12);
  assert.equal(yearly.yearlyScale(10), 60);
  assert.equal(yearly.yearlyShare(1, 4), 25);
  assert.equal(yearly.yearlyShare(1, 0), 0);
  assert.equal(yearly.describeYearly("YE01"), "seasonal yearly lane");
  assert.match(yearly.describeYearly("nope"), /^unknown yearly code/);
});

test("reports/cohort", () => {
  assert.equal(cohort.cohortWeight("b"), 7);
  assert.equal(cohort.cohortWeight("z"), 0);
  assert.equal(cohort.totalCohortWeight(["a", "c", "z"]), 14);
  assert.equal(cohort.cohortScale(10), 20);
  assert.equal(cohort.cohortShare(1, 4), 25);
  assert.equal(cohort.cohortShare(1, 0), 0);
  assert.equal(cohort.cohortLabel(1), "1 cohort");
  assert.equal(cohort.cohortLabel(3), "3 cohorts");
  assert.equal(cohort.cohortSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(cohort.cohortSummary({}), "none");
  assert.equal(cohort.describeCohort("CO01"), "returnable cohort profile");
  assert.match(cohort.describeCohort("nope"), /^unknown cohort code/);
});

test("reports/funnel", () => {
  assert.equal(funnel.funnelScale(10), 30);
  assert.equal(funnel.funnelShare(1, 4), 25);
  assert.equal(funnel.funnelShare(1, 0), 0);
  assert.equal(funnel.funnelLabel(1), "1 funnel");
  assert.equal(funnel.funnelLabel(3), "3 funnels");
  assert.equal(funnel.funnelSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(funnel.funnelSummary({}), "none");
  assert.equal(funnel.formatFunnel(" ab1 "), "FUN-AB1");
  assert.equal(funnel.parseFunnel("FUN-AB1"), "AB1");
  assert.equal(funnel.parseFunnel("zzz"), undefined);
  assert.equal(funnel.describeFunnel("FU01"), "perishable funnel quota");
  assert.match(funnel.describeFunnel("nope"), /^unknown funnel code/);
});

test("reports/churn", () => {
  assert.equal(churn.churnLabel(1), "1 churn");
  assert.equal(churn.churnLabel(3), "3 churns");
  assert.equal(churn.churnSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(churn.churnSummary({}), "none");
  assert.equal(churn.formatChurn(" ab1 "), "CHU-AB1");
  assert.equal(churn.parseChurn("CHU-AB1"), "AB1");
  assert.equal(churn.parseChurn("zzz"), undefined);
  assert.equal(churn.isChurnValid(107), true);
  assert.equal(churn.isChurnValid(108), false);
  assert.equal(churn.clampChurn(1000), 107);
  assert.equal(churn.describeChurn("CH01"), "regulated churn session");
  assert.match(churn.describeChurn("nope"), /^unknown churn code/);
});

test("reports/retention", () => {
  assert.equal(retention.formatRetention(" ab1 "), "RET-AB1");
  assert.equal(retention.parseRetention("RET-AB1"), "AB1");
  assert.equal(retention.parseRetention("zzz"), undefined);
  assert.equal(retention.isRetentionValid(108), true);
  assert.equal(retention.isRetentionValid(109), false);
  assert.equal(retention.clampRetention(1000), 108);
  assert.equal(retention.retentionWeight("b"), 10);
  assert.equal(retention.retentionWeight("z"), 0);
  assert.equal(retention.totalRetentionWeight(["a", "c", "z"]), 20);
  assert.equal(retention.describeRetention("RE01"), "oversized retention plan");
  assert.match(retention.describeRetention("nope"), /^unknown retention code/);
});

test("reports/margin", () => {
  assert.equal(margin.isMarginValid(109), true);
  assert.equal(margin.isMarginValid(110), false);
  assert.equal(margin.clampMargin(1000), 109);
  assert.equal(margin.marginWeight("b"), 11);
  assert.equal(margin.marginWeight("z"), 0);
  assert.equal(margin.totalMarginWeight(["a", "c", "z"]), 22);
  assert.equal(margin.marginScale(10), 60);
  assert.equal(margin.marginShare(1, 4), 25);
  assert.equal(margin.marginShare(1, 0), 0);
  assert.equal(margin.describeMargin("MA01"), "premium margin entry");
  assert.match(margin.describeMargin("nope"), /^unknown margin code/);
});

test("reports/revenue", () => {
  assert.equal(revenue.revenueWeight("b"), 12);
  assert.equal(revenue.revenueWeight("z"), 0);
  assert.equal(revenue.totalRevenueWeight(["a", "c", "z"]), 24);
  assert.equal(revenue.revenueScale(10), 20);
  assert.equal(revenue.revenueShare(1, 4), 25);
  assert.equal(revenue.revenueShare(1, 0), 0);
  assert.equal(revenue.revenueLabel(1), "1 revenue");
  assert.equal(revenue.revenueLabel(3), "3 revenues");
  assert.equal(revenue.revenueSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(revenue.revenueSummary({}), "none");
  assert.equal(revenue.describeRevenue("RE01"), "discounted revenue window");
  assert.match(revenue.describeRevenue("nope"), /^unknown revenue code/);
});

test("reports/cost", () => {
  assert.equal(cost.costScale(10), 30);
  assert.equal(cost.costShare(1, 4), 25);
  assert.equal(cost.costShare(1, 0), 0);
  assert.equal(cost.costLabel(1), "1 cost");
  assert.equal(cost.costLabel(3), "3 costs");
  assert.equal(cost.costSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(cost.costSummary({}), "none");
  assert.equal(cost.formatCost(" ab1 "), "COS-AB1");
  assert.equal(cost.parseCost("COS-AB1"), "AB1");
  assert.equal(cost.parseCost("zzz"), undefined);
  assert.equal(cost.describeCost("CO01"), "limited cost check");
  assert.match(cost.describeCost("nope"), /^unknown cost code/);
});

test("reports/basket", () => {
  assert.equal(basket.basketLabel(1), "1 basket");
  assert.equal(basket.basketLabel(3), "3 baskets");
  assert.equal(basket.basketSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(basket.basketSummary({}), "none");
  assert.equal(basket.formatBasket(" ab1 "), "BAS-AB1");
  assert.equal(basket.parseBasket("BAS-AB1"), "AB1");
  assert.equal(basket.parseBasket("zzz"), undefined);
  assert.equal(basket.isBasketValid(112), true);
  assert.equal(basket.isBasketValid(113), false);
  assert.equal(basket.clampBasket(1000), 112);
  assert.equal(basket.describeBasket("BA01"), "archived basket slot");
  assert.match(basket.describeBasket("nope"), /^unknown basket code/);
});

test("reports/average", () => {
  assert.equal(average.formatAverage(" ab1 "), "AVE-AB1");
  assert.equal(average.parseAverage("AVE-AB1"), "AB1");
  assert.equal(average.parseAverage("zzz"), undefined);
  assert.equal(average.isAverageValid(113), true);
  assert.equal(average.isAverageValid(114), false);
  assert.equal(average.clampAverage(1000), 113);
  assert.equal(average.averageWeight("b"), 15);
  assert.equal(average.averageWeight("z"), 0);
  assert.equal(average.totalAverageWeight(["a", "c", "z"]), 30);
  assert.equal(average.describeAverage("AV01"), "pending average group");
  assert.match(average.describeAverage("nope"), /^unknown average code/);
});

test("reports/median", () => {
  assert.equal(median.isMedianValid(114), true);
  assert.equal(median.isMedianValid(115), false);
  assert.equal(median.clampMedian(1000), 114);
  assert.equal(median.medianWeight("b"), 16);
  assert.equal(median.medianWeight("z"), 0);
  assert.equal(median.totalMedianWeight(["a", "c", "z"]), 32);
  assert.equal(median.medianScale(10), 60);
  assert.equal(median.medianShare(1, 4), 25);
  assert.equal(median.medianShare(1, 0), 0);
  assert.equal(median.describeMedian("ME01"), "verified median cap");
  assert.match(median.describeMedian("nope"), /^unknown median code/);
});

test("reports/percentile", () => {
  assert.equal(percentile.percentileWeight("b"), 17);
  assert.equal(percentile.percentileWeight("z"), 0);
  assert.equal(percentile.totalPercentileWeight(["a", "c", "z"]), 34);
  assert.equal(percentile.percentileScale(10), 20);
  assert.equal(percentile.percentileShare(1, 4), 25);
  assert.equal(percentile.percentileShare(1, 0), 0);
  assert.equal(percentile.percentileLabel(1), "1 percentile");
  assert.equal(percentile.percentileLabel(3), "3 percentiles");
  assert.equal(percentile.percentileSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(percentile.percentileSummary({}), "none");
  assert.equal(percentile.describePercentile("PE01"), "flagged percentile ledger");
  assert.match(percentile.describePercentile("nope"), /^unknown percentile code/);
});

test("reports/trend", () => {
  assert.equal(trend.trendScale(10), 30);
  assert.equal(trend.trendShare(1, 4), 25);
  assert.equal(trend.trendShare(1, 0), 0);
  assert.equal(trend.trendLabel(1), "1 trend");
  assert.equal(trend.trendLabel(3), "3 trends");
  assert.equal(trend.trendSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(trend.trendSummary({}), "none");
  assert.equal(trend.formatTrend(" ab1 "), "TRE-AB1");
  assert.equal(trend.parseTrend("TRE-AB1"), "AB1");
  assert.equal(trend.parseTrend("zzz"), undefined);
  assert.equal(trend.describeTrend("TR01"), "manual trend notice");
  assert.match(trend.describeTrend("nope"), /^unknown trend code/);
});

test("reports/forecast", () => {
  assert.equal(forecast.forecastLabel(1), "1 forecast");
  assert.equal(forecast.forecastLabel(3), "3 forecasts");
  assert.equal(forecast.forecastSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(forecast.forecastSummary({}), "none");
  assert.equal(forecast.formatForecast(" ab1 "), "FOR-AB1");
  assert.equal(forecast.parseForecast("FOR-AB1"), "AB1");
  assert.equal(forecast.parseForecast("zzz"), undefined);
  assert.equal(forecast.isForecastValid(117), true);
  assert.equal(forecast.isForecastValid(118), false);
  assert.equal(forecast.clampForecast(1000), 117);
  assert.equal(forecast.describeForecast("FO01"), "automatic forecast record");
  assert.match(forecast.describeForecast("nope"), /^unknown forecast code/);
});

test("reports/anomaly", () => {
  assert.equal(anomaly.formatAnomaly(" ab1 "), "ANO-AB1");
  assert.equal(anomaly.parseAnomaly("ANO-AB1"), "AB1");
  assert.equal(anomaly.parseAnomaly("zzz"), undefined);
  assert.equal(anomaly.isAnomalyValid(118), true);
  assert.equal(anomaly.isAnomalyValid(119), false);
  assert.equal(anomaly.clampAnomaly(1000), 118);
  assert.equal(anomaly.anomalyWeight("b"), 20);
  assert.equal(anomaly.anomalyWeight("z"), 0);
  assert.equal(anomaly.totalAnomalyWeight(["a", "c", "z"]), 40);
  assert.equal(anomaly.describeAnomaly("AN01"), "partial anomaly route");
  assert.match(anomaly.describeAnomaly("nope"), /^unknown anomaly code/);
});

test("reports/segment", () => {
  assert.equal(segment.isSegmentValid(119), true);
  assert.equal(segment.isSegmentValid(120), false);
  assert.equal(segment.clampSegment(1000), 119);
  assert.equal(segment.segmentWeight("b"), 21);
  assert.equal(segment.segmentWeight("z"), 0);
  assert.equal(segment.totalSegmentWeight(["a", "c", "z"]), 42);
  assert.equal(segment.segmentScale(10), 60);
  assert.equal(segment.segmentShare(1, 4), 25);
  assert.equal(segment.segmentShare(1, 0), 0);
  assert.equal(segment.describeSegment("SE01"), "primary segment rule");
  assert.match(segment.describeSegment("nope"), /^unknown segment code/);
});

test("reports/region", () => {
  assert.equal(region.regionWeight("b"), 22);
  assert.equal(region.regionWeight("z"), 0);
  assert.equal(region.totalRegionWeight(["a", "c", "z"]), 44);
  assert.equal(region.regionScale(10), 20);
  assert.equal(region.regionShare(1, 4), 25);
  assert.equal(region.regionShare(1, 0), 0);
  assert.equal(region.regionLabel(1), "1 region");
  assert.equal(region.regionLabel(3), "3 regions");
  assert.equal(region.regionSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(region.regionSummary({}), "none");
  assert.equal(region.describeRegion("RE01"), "secondary region queue");
  assert.match(region.describeRegion("nope"), /^unknown region code/);
});

test("reports/category", () => {
  assert.equal(category.categoryScale(10), 30);
  assert.equal(category.categoryShare(1, 4), 25);
  assert.equal(category.categoryShare(1, 0), 0);
  assert.equal(category.categoryLabel(1), "1 category");
  assert.equal(category.categoryLabel(3), "3 categorys");
  assert.equal(category.categorySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(category.categorySummary({}), "none");
  assert.equal(category.formatCategory(" ab1 "), "CAT-AB1");
  assert.equal(category.parseCategory("CAT-AB1"), "AB1");
  assert.equal(category.parseCategory("zzz"), undefined);
  assert.equal(category.describeCategory("CA01"), "legacy category tier");
  assert.match(category.describeCategory("nope"), /^unknown category code/);
});

test("reports/brand", () => {
  assert.equal(brand.brandLabel(1), "1 brand");
  assert.equal(brand.brandLabel(3), "3 brands");
  assert.equal(brand.brandSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(brand.brandSummary({}), "none");
  assert.equal(brand.formatBrand(" ab1 "), "BRA-AB1");
  assert.equal(brand.parseBrand("BRA-AB1"), "AB1");
  assert.equal(brand.parseBrand("zzz"), undefined);
  assert.equal(brand.isBrandValid(122), true);
  assert.equal(brand.isBrandValid(123), false);
  assert.equal(brand.clampBrand(1000), 122);
  assert.equal(brand.describeBrand("BR01"), "trial brand rate");
  assert.match(brand.describeBrand("nope"), /^unknown brand code/);
});

test("reports/supplier", () => {
  assert.equal(supplier.formatSupplier(" ab1 "), "SUP-AB1");
  assert.equal(supplier.parseSupplier("SUP-AB1"), "AB1");
  assert.equal(supplier.parseSupplier("zzz"), undefined);
  assert.equal(supplier.isSupplierValid(123), true);
  assert.equal(supplier.isSupplierValid(124), false);
  assert.equal(supplier.clampSupplier(1000), 123);
  assert.equal(supplier.supplierWeight("b"), 25);
  assert.equal(supplier.supplierWeight("z"), 0);
  assert.equal(supplier.totalSupplierWeight(["a", "c", "z"]), 50);
  assert.equal(supplier.describeSupplier("SU01"), "internal supplier cycle");
  assert.match(supplier.describeSupplier("nope"), /^unknown supplier code/);
});

test("reports/staff", () => {
  assert.equal(staff.isStaffValid(124), true);
  assert.equal(staff.isStaffValid(125), false);
  assert.equal(staff.clampStaff(1000), 124);
  assert.equal(staff.staffWeight("b"), 26);
  assert.equal(staff.staffWeight("z"), 0);
  assert.equal(staff.totalStaffWeight(["a", "c", "z"]), 52);
  assert.equal(staff.staffScale(10), 60);
  assert.equal(staff.staffShare(1, 4), 25);
  assert.equal(staff.staffShare(1, 0), 0);
  assert.equal(staff.describeStaff("ST01"), "external staff contact");
  assert.match(staff.describeStaff("nope"), /^unknown staff code/);
});

test("reports/shift", () => {
  assert.equal(shift.shiftWeight("b"), 27);
  assert.equal(shift.shiftWeight("z"), 0);
  assert.equal(shift.totalShiftWeight(["a", "c", "z"]), 54);
  assert.equal(shift.shiftScale(10), 20);
  assert.equal(shift.shiftShare(1, 4), 25);
  assert.equal(shift.shiftShare(1, 0), 0);
  assert.equal(shift.shiftLabel(1), "1 shift");
  assert.equal(shift.shiftLabel(3), "3 shifts");
  assert.equal(shift.shiftSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(shift.shiftSummary({}), "none");
  assert.equal(shift.describeShift("SH01"), "priority shift request");
  assert.match(shift.describeShift("nope"), /^unknown shift code/);
});

test("reports/coverage", () => {
  assert.equal(coverage.coverageScale(10), 30);
  assert.equal(coverage.coverageShare(1, 4), 25);
  assert.equal(coverage.coverageShare(1, 0), 0);
  assert.equal(coverage.coverageLabel(1), "1 coverage");
  assert.equal(coverage.coverageLabel(3), "3 coverages");
  assert.equal(coverage.coverageSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(coverage.coverageSummary({}), "none");
  assert.equal(coverage.formatCoverage(" ab1 "), "COV-AB1");
  assert.equal(coverage.parseCoverage("COV-AB1"), "AB1");
  assert.equal(coverage.parseCoverage("zzz"), undefined);
  assert.equal(coverage.describeCoverage("CO01"), "deferred coverage batch");
  assert.match(coverage.describeCoverage("nope"), /^unknown coverage code/);
});

test("reports/backlog", () => {
  assert.equal(backlog.backlogLabel(1), "1 backlog");
  assert.equal(backlog.backlogLabel(3), "3 backlogs");
  assert.equal(backlog.backlogSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(backlog.backlogSummary({}), "none");
  assert.equal(backlog.formatBacklog(" ab1 "), "BAC-AB1");
  assert.equal(backlog.parseBacklog("BAC-AB1"), "AB1");
  assert.equal(backlog.parseBacklog("zzz"), undefined);
  assert.equal(backlog.isBacklogValid(127), true);
  assert.equal(backlog.isBacklogValid(128), false);
  assert.equal(backlog.clampBacklog(1000), 127);
  assert.equal(backlog.describeBacklog("BA01"), "standard backlog policy");
  assert.match(backlog.describeBacklog("nope"), /^unknown backlog code/);
});

test("reports/aging", () => {
  assert.equal(aging.formatAging(" ab1 "), "AGI-AB1");
  assert.equal(aging.parseAging("AGI-AB1"), "AB1");
  assert.equal(aging.parseAging("zzz"), undefined);
  assert.equal(aging.isAgingValid(128), true);
  assert.equal(aging.isAgingValid(129), false);
  assert.equal(aging.clampAging(1000), 128);
  assert.equal(aging.agingWeight("b"), 30);
  assert.equal(aging.agingWeight("z"), 0);
  assert.equal(aging.totalAgingWeight(["a", "c", "z"]), 60);
  assert.equal(aging.describeAging("AG01"), "express aging ticket");
  assert.match(aging.describeAging("nope"), /^unknown aging code/);
});

test("reports/turnover", () => {
  assert.equal(turnover.isTurnoverValid(129), true);
  assert.equal(turnover.isTurnoverValid(130), false);
  assert.equal(turnover.clampTurnover(1000), 129);
  assert.equal(turnover.turnoverWeight("b"), 31);
  assert.equal(turnover.turnoverWeight("z"), 0);
  assert.equal(turnover.totalTurnoverWeight(["a", "c", "z"]), 62);
  assert.equal(turnover.turnoverScale(10), 60);
  assert.equal(turnover.turnoverShare(1, 4), 25);
  assert.equal(turnover.turnoverShare(1, 0), 0);
  assert.equal(turnover.describeTurnover("TU01"), "fragile turnover lane");
  assert.match(turnover.describeTurnover("nope"), /^unknown turnover code/);
});

test("reports/extract", () => {
  assert.equal(extract.extractWeight("b"), 32);
  assert.equal(extract.extractWeight("z"), 0);
  assert.equal(extract.totalExtractWeight(["a", "c", "z"]), 64);
  assert.equal(extract.extractScale(10), 20);
  assert.equal(extract.extractShare(1, 4), 25);
  assert.equal(extract.extractShare(1, 0), 0);
  assert.equal(extract.extractLabel(1), "1 extract");
  assert.equal(extract.extractLabel(3), "3 extracts");
  assert.equal(extract.extractSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(extract.extractSummary({}), "none");
  assert.equal(extract.describeExtract("EX01"), "bulky extract profile");
  assert.match(extract.describeExtract("nope"), /^unknown extract code/);
});

test("reports/snapshot", () => {
  assert.equal(snapshot.snapshotScale(10), 30);
  assert.equal(snapshot.snapshotShare(1, 4), 25);
  assert.equal(snapshot.snapshotShare(1, 0), 0);
  assert.equal(snapshot.snapshotLabel(1), "1 snapshot");
  assert.equal(snapshot.snapshotLabel(3), "3 snapshots");
  assert.equal(snapshot.snapshotSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(snapshot.snapshotSummary({}), "none");
  assert.equal(snapshot.formatSnapshot(" ab1 "), "SNA-AB1");
  assert.equal(snapshot.parseSnapshot("SNA-AB1"), "AB1");
  assert.equal(snapshot.parseSnapshot("zzz"), undefined);
  assert.equal(snapshot.describeSnapshot("SN01"), "seasonal snapshot quota");
  assert.match(snapshot.describeSnapshot("nope"), /^unknown snapshot code/);
});

test("reports/rollup", () => {
  assert.equal(rollup.rollupLabel(1), "1 rollup");
  assert.equal(rollup.rollupLabel(3), "3 rollups");
  assert.equal(rollup.rollupSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(rollup.rollupSummary({}), "none");
  assert.equal(rollup.formatRollup(" ab1 "), "ROL-AB1");
  assert.equal(rollup.parseRollup("ROL-AB1"), "AB1");
  assert.equal(rollup.parseRollup("zzz"), undefined);
  assert.equal(rollup.isRollupValid(132), true);
  assert.equal(rollup.isRollupValid(133), false);
  assert.equal(rollup.clampRollup(1000), 132);
  assert.equal(rollup.describeRollup("RO01"), "returnable rollup session");
  assert.match(rollup.describeRollup("nope"), /^unknown rollup code/);
});

test("reports/pivot", () => {
  assert.equal(pivot.formatPivot(" ab1 "), "PIV-AB1");
  assert.equal(pivot.parsePivot("PIV-AB1"), "AB1");
  assert.equal(pivot.parsePivot("zzz"), undefined);
  assert.equal(pivot.isPivotValid(133), true);
  assert.equal(pivot.isPivotValid(134), false);
  assert.equal(pivot.clampPivot(1000), 133);
  assert.equal(pivot.pivotWeight("b"), 35);
  assert.equal(pivot.pivotWeight("z"), 0);
  assert.equal(pivot.totalPivotWeight(["a", "c", "z"]), 70);
  assert.equal(pivot.describePivot("PI01"), "perishable pivot plan");
  assert.match(pivot.describePivot("nope"), /^unknown pivot code/);
});

test("reports/bucket", () => {
  assert.equal(bucket.isBucketValid(134), true);
  assert.equal(bucket.isBucketValid(135), false);
  assert.equal(bucket.clampBucket(1000), 134);
  assert.equal(bucket.bucketWeight("b"), 36);
  assert.equal(bucket.bucketWeight("z"), 0);
  assert.equal(bucket.totalBucketWeight(["a", "c", "z"]), 72);
  assert.equal(bucket.bucketScale(10), 60);
  assert.equal(bucket.bucketShare(1, 4), 25);
  assert.equal(bucket.bucketShare(1, 0), 0);
  assert.equal(bucket.describeBucket("BU01"), "regulated bucket entry");
  assert.match(bucket.describeBucket("nope"), /^unknown bucket code/);
});

test("reports/window-avg", () => {
  assert.equal(windowAvg.windowAvgWeight("b"), 37);
  assert.equal(windowAvg.windowAvgWeight("z"), 0);
  assert.equal(windowAvg.totalWindowAvgWeight(["a", "c", "z"]), 74);
  assert.equal(windowAvg.windowAvgScale(10), 20);
  assert.equal(windowAvg.windowAvgShare(1, 4), 25);
  assert.equal(windowAvg.windowAvgShare(1, 0), 0);
  assert.equal(windowAvg.windowAvgLabel(1), "1 window-avg");
  assert.equal(windowAvg.windowAvgLabel(3), "3 window-avgs");
  assert.equal(windowAvg.windowAvgSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(windowAvg.windowAvgSummary({}), "none");
  assert.equal(windowAvg.describeWindowAvg("WI01"), "oversized window-avg window");
  assert.match(windowAvg.describeWindowAvg("nope"), /^unknown window-avg code/);
});

test("reports/outlier", () => {
  assert.equal(outlier.outlierScale(10), 30);
  assert.equal(outlier.outlierShare(1, 4), 25);
  assert.equal(outlier.outlierShare(1, 0), 0);
  assert.equal(outlier.outlierLabel(1), "1 outlier");
  assert.equal(outlier.outlierLabel(3), "3 outliers");
  assert.equal(outlier.outlierSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(outlier.outlierSummary({}), "none");
  assert.equal(outlier.formatOutlier(" ab1 "), "OUT-AB1");
  assert.equal(outlier.parseOutlier("OUT-AB1"), "AB1");
  assert.equal(outlier.parseOutlier("zzz"), undefined);
  assert.equal(outlier.describeOutlier("OU01"), "premium outlier check");
  assert.match(outlier.describeOutlier("nope"), /^unknown outlier code/);
});

test("reports/rank", () => {
  assert.equal(rank.rankLabel(1), "1 rank");
  assert.equal(rank.rankLabel(3), "3 ranks");
  assert.equal(rank.rankSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(rank.rankSummary({}), "none");
  assert.equal(rank.formatRank(" ab1 "), "RAN-AB1");
  assert.equal(rank.parseRank("RAN-AB1"), "AB1");
  assert.equal(rank.parseRank("zzz"), undefined);
  assert.equal(rank.isRankValid(137), true);
  assert.equal(rank.isRankValid(138), false);
  assert.equal(rank.clampRank(1000), 137);
  assert.equal(rank.describeRank("RA01"), "discounted rank slot");
  assert.match(rank.describeRank("nope"), /^unknown rank code/);
});
