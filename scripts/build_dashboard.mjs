import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const project = path.resolve(process.argv[2] || path.join(import.meta.dirname, ".."));
const dashboardDir = path.join(project, "dashboard_data");
const analysisDir = path.join(project, "analysis_outputs");
const outputPath = path.join(project, "Customer_Purchase_Behavior_Sales_Dashboard.xlsx");
const previewPath = path.join(project, "dashboard_preview.png");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ""));
}

async function csv(name, folder = dashboardDir) {
  return parseCsv(await fs.readFile(path.join(folder, name), "utf8"));
}

function typed(rows, numericHeaders = []) {
  const numeric = new Set(numericHeaders);
  return rows.map((row, ri) => row.map((value, ci) => {
    if (ri === 0) return value;
    if (numeric.has(rows[0][ci])) {
      if (value === "" || value === "nan") return 0;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }));
}

function addKey(rows, keyColumns, name = "lookup_key") {
  const header = rows[0];
  const indexes = keyColumns.map(c => header.indexOf(c));
  return [[name, ...header], ...rows.slice(1).map(r => [indexes.map(i => r[i]).join("|"), ...r])];
}

function writeTable(sheet, startCell, rows, tableName) {
  const start = sheet.getRange(startCell);
  start.write(rows);
  const region = start.getCurrentRegion();
  const table = sheet.tables.add(region, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(1);
  sheet.showGridlines = false;
  region.format.font = { name: "Arial", size: 9, color: "#172033" };
  region.getRow(0).format = {
    fill: "#17365D",
    font: { name: "Arial", size: 9, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  region.format.autofitColumns();
  return region;
}

const colors = {
  navy: "#17365D", blue: "#2F75B5", lightBlue: "#D9EAF7", gold: "#D9A441",
  orange: "#ED7D31", ink: "#172033", muted: "#667085", pale: "#F5F7FA",
  border: "#D0D5DD", white: "#FFFFFF", olive: "#7F8C4F", pink: "#C75B7A",
};

const kpi = addKey(typed(await csv("dashboard_kpi_cube.csv"), ["revenue", "orders", "customers", "aov", "repeat_rate_pct", "quantity"]), ["year_filter", "country_filter", "customer_type_filter"]);
const monthly = addKey(typed(await csv("dashboard_monthly_cube.csv"), ["revenue", "quantity", "orders"]), ["year_filter", "country_filter", "customer_type_filter", "invoice_month"]);
const productRaw = typed(await csv("dashboard_product_cube.csv"), ["rank", "revenue", "quantity", "orders"]);
productRaw[0].splice(6, 0, "short_description");
for (let i = 1; i < productRaw.length; i++) productRaw[i].splice(6, 0, String(productRaw[i][5] || productRaw[i][4]).slice(0, 32));
const product = addKey(productRaw, ["year_filter", "country_filter", "customer_type_filter", "rank"]);
const customer = addKey(typed(await csv("dashboard_customer_cube.csv"), ["rank", "customer_id", "revenue", "orders"]), ["year_filter", "country_filter", "customer_type_filter", "rank"]);
const behavior = addKey(typed(await csv("dashboard_behavior_cube.csv"), ["customers", "revenue", "orders"]), ["year_filter", "country_filter", "customer_type"]);
const countryRaw = typed(await csv("dashboard_country_cube.csv"), ["rank", "revenue", "quantity", "orders"]);
const countryRank = addKey(countryRaw, ["year_filter", "customer_type_filter", "rank"], "rank_key");
countryRank[0].splice(1, 0, "name_key");
for (let i = 1; i < countryRank.length; i++) {
  const r = countryRank[i];
  r.splice(1, 0, `${r[1]}|${r[2]}|${r[4]}`);
}
const years = await csv("filter_years.csv");
const countries = await csv("filter_countries.csv");
const types = await csv("filter_customer_types.csv");
const monthList = (await csv("monthly_trends.csv", analysisDir)).slice(1).map(r => [r[0]]);

const wb = Workbook.create();
const dashboard = wb.worksheets.add("Dashboard");
const chartData = wb.worksheets.add("Chart Data");
const analysis = wb.worksheets.add("Analysis Tables");
const validation = wb.worksheets.add("Metrics Validation");
const methodology = wb.worksheets.add("Methodology");
const divider = wb.worksheets.add("Data >>");
const kpiSheet = wb.worksheets.add("KPI Cube");
const monthSheet = wb.worksheets.add("Month Cube");
const productSheet = wb.worksheets.add("Product Cube");
const customerSheet = wb.worksheets.add("Customer Cube");
const behaviorSheet = wb.worksheets.add("Behavior Cube");
const countrySheet = wb.worksheets.add("Country Cube");
const lists = wb.worksheets.add("Lists");

for (const s of wb.worksheets.items) s.showGridlines = false;

writeTable(kpiSheet, "A1", kpi, "KpiCubeTable");
writeTable(monthSheet, "A1", monthly, "MonthCubeTable");
writeTable(productSheet, "A1", product, "ProductCubeTable");
writeTable(customerSheet, "A1", customer, "CustomerCubeTable");
writeTable(behaviorSheet, "A1", behavior, "BehaviorCubeTable");
writeTable(countrySheet, "A1", countryRank, "CountryCubeTable");

lists.getRange("A1").write(years);
lists.getRange("B1").write(countries);
lists.getRange("C1").write(types);
lists.getRange("D1").values = [["invoice_month"]];
lists.getRange(`D2:D${monthList.length + 1}`).values = monthList;
writeTable(lists, "A1", [years[0], ...years.slice(1)], "YearFilterList");
lists.getRange("B1").write(countries);
lists.getRange("C1").write(types);
lists.getRange("D1").values = [["invoice_month"]];
lists.getRange(`D2:D${monthList.length + 1}`).values = monthList;
lists.getRange("A1:D50").format.font = { name: "Arial", size: 9, color: colors.ink };
lists.getRange("A1:D1").format = { fill: colors.navy, font: { name: "Arial", size: 9, bold: true, color: colors.white } };

// Dashboard foundation and controls.
dashboard.getRange("B2:S2").format.borders = { bottom: { style: "thin", color: colors.navy } };
dashboard.getRange("B2").values = [["Customer Purchase Behavior & Sales Analytics"]];
dashboard.getRange("B2").format.font = { name: "Arial", size: 16, bold: true, color: colors.navy };
dashboard.getRange("B3").values = [["Online Retail II | Valid positive, non-cancelled, deduplicated transactions | Dec 2009–Dec 2011"]];
dashboard.getRange("B3").format.font = { name: "Arial", size: 10, italic: true, color: colors.muted };
dashboard.getRange("B4:C4").values = [["Period", null]];
dashboard.getRange("E4:F4").values = [["Country", null]];
dashboard.getRange("H4:I4").values = [["Customer type", null]];
for (const a of ["B4:C4", "E4:F4", "H4:I4"]) dashboard.getRange(a).format = { fill: colors.lightBlue, font: { name: "Arial", size: 9, bold: true, color: colors.navy } };
dashboard.getRange("B5:C5").merge(); dashboard.getRange("B5").values = [["All"]];
dashboard.getRange("E5:F5").merge(); dashboard.getRange("E5").values = [["All"]];
dashboard.getRange("H5:I5").merge(); dashboard.getRange("H5").values = [["All"]];
for (const a of ["B5:C5", "E5:F5", "H5:I5"]) dashboard.getRange(a).format = { fill: "#FFF2CC", font: { name: "Arial", size: 10, bold: true, color: colors.ink }, horizontalAlignment: "center", borders: { top: { style: "thin", color: colors.gold }, bottom: { style: "thin", color: colors.gold }, left: { style: "thin", color: colors.gold }, right: { style: "thin", color: colors.gold } } };
dashboard.getRange("B5").dataValidation = { rule: { type: "list", formula1: `Lists!$A$2:$A$${years.length}` } };
dashboard.getRange("E5").dataValidation = { rule: { type: "list", formula1: `Lists!$B$2:$B$${countries.length}` } };
dashboard.getRange("H5").dataValidation = { rule: { type: "list", formula1: `Lists!$C$2:$C$${types.length}` } };
dashboard.getRange("K4:S4").merge();
dashboard.getRange("K5:S5").merge();
dashboard.getRange("K4").values = [["Use the three yellow dropdowns to update every KPI and chart."]];
dashboard.getRange("K5").values = [["Customer type uses full-period purchase history; repeat rate is recalculated within the selected view."]];
dashboard.getRange("K4:S5").format = { font: { name: "Arial", size: 9, italic: true, color: colors.muted }, wrapText: true };

const kpiEnd = kpi.length;
const key = `$B$5&"|"&$E$5&"|"&$H$5`;
const cards = [
  ["B7:D10", "Total Revenue", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},5,FALSE),0)`, '"£"#,##0;[Red]-"£"#,##0;–'],
  ["E7:G10", "Total Orders", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},6,FALSE),0)`, '#,##0'],
  ["H7:J10", "Customers", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},7,FALSE),0)`, '#,##0'],
  ["K7:M10", "Average Order Value", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},8,FALSE),0)`, '"£"#,##0.00'],
  ["N7:P10", "Repeat Purchase Rate", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},9,FALSE)/100,0)`, '0.0%'],
  ["Q7:S10", "Quantity Sold", `=IFERROR(VLOOKUP(${key},'KPI Cube'!$A$2:$J$${kpiEnd},10,FALSE),0)`, '#,##0'],
];
for (const [area, label, formula, format] of cards) {
  const r = dashboard.getRange(area);
  r.format = { fill: colors.pale, font: { name: "Arial", size: 10, color: colors.ink }, borders: { top: { style: "thin", color: colors.border }, bottom: { style: "thin", color: colors.border }, left: { style: "thin", color: colors.border }, right: { style: "thin", color: colors.border } } };
  const topLeft = area.split(":")[0];
  const col = topLeft.match(/[A-Z]+/)[0];
  dashboard.getRange(`${col}8`).values = [[label]];
  dashboard.getRange(`${col}8`).format.font = { name: "Arial", size: 9, bold: true, color: colors.muted };
  dashboard.getRange(`${col}9`).formulas = [[formula]];
  dashboard.getRange(`${col}9`).format.font = { name: "Arial", size: 15, bold: true, color: colors.navy };
  dashboard.getRange(`${col}9`).setNumberFormat(format);
}

// Formula-backed chart helper data.
chartData.getRange("A1:C1").values = [["Month", "Revenue", "Quantity"]];
for (let i = 0; i < 25; i++) {
  const row = i + 2;
  chartData.getRange(`A${row}`).formulas = [[`=IF(Dashboard!$B$5="All",IFERROR(INDEX(Lists!$D$2:$D$26,ROW()-1),""),IF(ROW()-1<=12,Dashboard!$B$5&"-"&TEXT(ROW()-1,"00"),""))`]];
  const monthKey = `Dashboard!$B$5&"|"&Dashboard!$E$5&"|"&Dashboard!$H$5&"|"&A${row}`;
  chartData.getRange(`B${row}`).formulas = [[`=IF(A${row}="","",IFERROR(VLOOKUP(${monthKey},'Month Cube'!$A$2:$H$${monthly.length},6,FALSE),0))`]];
  chartData.getRange(`C${row}`).formulas = [[`=IF(A${row}="","",IFERROR(VLOOKUP(${monthKey},'Month Cube'!$A$2:$H$${monthly.length},7,FALSE),0))`]];
}
chartData.getRange("E1:F1").values = [["Product", "Revenue"]];
for (let i = 1; i <= 10; i++) {
  const row = i + 1;
  const lookup = `Dashboard!$B$5&"|"&Dashboard!$E$5&"|"&Dashboard!$H$5&"|"&${i}`;
  chartData.getRange(`E${row}`).formulas = [[`=IFERROR(VLOOKUP(${lookup},'Product Cube'!$A$2:$L$${product.length},8,FALSE),"")`]];
  chartData.getRange(`F${row}`).formulas = [[`=IFERROR(VLOOKUP(${lookup},'Product Cube'!$A$2:$K$${product.length},9,FALSE),0)`]];
}
chartData.getRange("H1:I1").values = [["Customer", "Revenue"]];
for (let i = 1; i <= 10; i++) {
  const row = i + 1;
  const lookup = `Dashboard!$B$5&"|"&Dashboard!$E$5&"|"&Dashboard!$H$5&"|"&${i}`;
  chartData.getRange(`H${row}`).formulas = [[`=IFERROR("Customer "&TEXT(VLOOKUP(${lookup},'Customer Cube'!$A$2:$H$${customer.length},6,FALSE),"0"),"")`]];
  chartData.getRange(`I${row}`).formulas = [[`=IFERROR(VLOOKUP(${lookup},'Customer Cube'!$A$2:$H$${customer.length},7,FALSE),0)`]];
}
chartData.getRange("K1:L1").values = [["Customer Type", "Customers"]];
chartData.getRange("K2:K3").values = [["Repeat"], ["One-time"]];
for (let row = 2; row <= 3; row++) {
  const lookup = `Dashboard!$B$5&"|"&Dashboard!$E$5&"|"&K${row}`;
  chartData.getRange(`L${row}`).formulas = [[`=IFERROR(VLOOKUP(${lookup},'Behavior Cube'!$A$2:$G$${behavior.length},5,FALSE),0)`]];
}
chartData.getRange("N1:O1").values = [["Country", "Revenue"]];
for (let i = 1; i <= 10; i++) {
  const row = i + 1;
  const rankLookup = `Dashboard!$B$5&"|"&Dashboard!$H$5&"|"&${i}`;
  chartData.getRange(`N${row}`).formulas = [[`=IF(Dashboard!$E$5="All",IFERROR(VLOOKUP(${rankLookup},'Country Cube'!$A$2:$I$${countryRank.length},6,FALSE),""),IF(ROW()=2,Dashboard!$E$5,""))`]];
  chartData.getRange(`O${row}`).formulas = [[`=IF(N${row}="","",IF(Dashboard!$E$5="All",IFERROR(VLOOKUP(${rankLookup},'Country Cube'!$A$2:$I$${countryRank.length},7,FALSE),0),IFERROR(SUMIFS('Country Cube'!$G$2:$G$${countryRank.length},'Country Cube'!$C$2:$C$${countryRank.length},Dashboard!$B$5,'Country Cube'!$D$2:$D$${countryRank.length},Dashboard!$H$5,'Country Cube'!$F$2:$F$${countryRank.length},Dashboard!$E$5),0)))`]];
}
chartData.getRange("A1:O26").format.font = { name: "Arial", size: 9, color: colors.ink };
for (const a of ["A1:C1", "E1:F1", "H1:I1", "K1:L1", "N1:O1"]) chartData.getRange(a).format = { fill: colors.navy, font: { name: "Arial", size: 9, bold: true, color: colors.white } };
chartData.getRange("B2:B26").setNumberFormat('"£"#,##0');
chartData.getRange("C2:C26").format.numberFormat = "#,##0";
chartData.getRange("F2:F11").setNumberFormat('"£"#,##0');
chartData.getRange("I2:I11").setNumberFormat('"£"#,##0');
chartData.getRange("O2:O11").setNumberFormat('"£"#,##0');

function styleChart(chart, title, legend = false) {
  chart.title = title;
  chart.titleTextStyle.fontSize = 12;
  chart.titleTextStyle.typeface = "Arial";
  chart.hasLegend = legend;
  if (legend) chart.legend = { position: "top", textStyle: { typeface: "Arial", fontSize: 9 } };
}

const revenueChart = dashboard.charts.add("line", [chartData.getRange("A1:A26"), chartData.getRange("B1:B26")]);
styleChart(revenueChart, "Monthly Revenue (£)");
revenueChart.setPosition("B13", "J29");
revenueChart.yAxis = { numberFormatCode: '"£"0.0,,"M"', numberFormatSourceLinked: false, textStyle: { typeface: "Arial", fontSize: 9 } };
revenueChart.xAxis = { axisType: "textAxis", textStyle: { typeface: "Arial", fontSize: 8 } };
if (revenueChart.series.items[0]) revenueChart.series.items[0].line = { color: colors.blue, width: 2 };

const behaviorChart = dashboard.charts.add("doughnut", chartData.getRange("K1:L3"));
styleChart(behaviorChart, "Repeat vs One-time Customers", true);
behaviorChart.setPosition("L13", "S29");
if (behaviorChart.series.items[0]) behaviorChart.series.items[0].fill = colors.gold;

const productChart = dashboard.charts.add("bar", chartData.getRange("E1:F11"));
styleChart(productChart, "Top 10 Products by Revenue");
productChart.setPosition("B32", "J49");
productChart.yAxis = { numberFormatCode: '"£"0,"K"', numberFormatSourceLinked: false, textStyle: { typeface: "Arial", fontSize: 9 } };
productChart.xAxis = { textStyle: { typeface: "Arial", fontSize: 8 } };
if (productChart.barOptions) productChart.barOptions.direction = "bar";
if (productChart.series.items[0]) productChart.series.items[0].fill = colors.blue;

const customerChart = dashboard.charts.add("bar", chartData.getRange("H1:I11"));
styleChart(customerChart, "Top 10 Customers by Revenue");
customerChart.setPosition("L32", "S49");
customerChart.yAxis = { numberFormatCode: '"£"0,"K"', numberFormatSourceLinked: false, textStyle: { typeface: "Arial", fontSize: 9 } };
if (customerChart.barOptions) customerChart.barOptions.direction = "bar";
if (customerChart.series.items[0]) customerChart.series.items[0].fill = colors.gold;

const countryChart = dashboard.charts.add("bar", chartData.getRange("N1:O11"));
styleChart(countryChart, "Country / Market Revenue");
countryChart.setPosition("B52", "J69");
countryChart.yAxis = { numberFormatCode: '"£"0.0,,"M"', numberFormatSourceLinked: false, textStyle: { typeface: "Arial", fontSize: 9 } };
if (countryChart.barOptions) countryChart.barOptions.direction = "bar";
if (countryChart.series.items[0]) countryChart.series.items[0].fill = colors.olive;

const quantityChart = dashboard.charts.add("line", [chartData.getRange("A1:A26"), chartData.getRange("C1:C26")]);
styleChart(quantityChart, "Monthly Quantity Sold");
quantityChart.setPosition("L52", "S69");
quantityChart.yAxis = { numberFormatCode: '#,##0', numberFormatSourceLinked: false, textStyle: { typeface: "Arial", fontSize: 9 } };
quantityChart.xAxis = { axisType: "textAxis", textStyle: { typeface: "Arial", fontSize: 8 } };
if (quantityChart.series.items[0]) quantityChart.series.items[0].line = { color: colors.orange, width: 2 };

dashboard.getRange("B72:S72").format = { fill: colors.navy, font: { name: "Arial", size: 10, bold: true, color: colors.white } };
dashboard.getRange("B72").values = [["Dashboard notes"]];
for (let row = 73; row <= 76; row++) dashboard.getRange(`B${row}:S${row}`).merge();
dashboard.getRange("B73").values = [["Sales totals include valid purchases without a Customer ID. Customer count, repeat rate, and customer rankings exclude missing Customer IDs."]];
dashboard.getRange("B74").values = [["December 2009 and December 2011 are partial months; use caution when comparing boundary months or full calendar years."]];
dashboard.getRange("B75").values = [["The country chart shows the top 10 markets when Country = All; selecting one country isolates that market."]];
dashboard.getRange("B76").values = [["Source: online_retail_II.xlsx; calculations generated from the accompanying SQLite cleaning and analysis scripts."]];
dashboard.getRange("B73:S76").format = { font: { name: "Arial", size: 9, color: colors.muted }, wrapText: true };
dashboard.getRange("B:S").format.columnWidth = 11;
dashboard.getRange("B:B").format.columnWidth = 14;
dashboard.getRange("S:S").format.columnWidth = 12;
dashboard.getRange("2:76").format.rowHeight = 18;
dashboard.getRange("2:2").format.rowHeight = 26;
dashboard.getRange("3:3").format.rowHeight = 22;
dashboard.getRange("5:5").format.rowHeight = 24;

// Filterable analysis tables.
const monthlyAnalysis = typed(await csv("monthly_trends.csv", analysisDir), ["revenue", "quantity_sold", "orders", "customers", "aov"]);
const productAnalysis = typed(await csv("product_performance.csv", analysisDir), ["revenue", "quantity_sold", "orders", "customers", "realized_unit_price"]);
const countryAnalysis = typed(await csv("country_performance.csv", analysisDir), ["revenue", "quantity_sold", "orders", "customers", "aov", "revenue_share_pct"]);
const customerAnalysis = typed(await csv("customer_metrics.csv", analysisDir), ["customer_id", "order_count", "total_spend", "average_order_value", "total_quantity", "known_customer_revenue_share_pct", "revenue_rank", "cumulative_known_revenue_pct"]);
const repeatAnalysis = typed(await csv("repeat_vs_one_time.csv", analysisDir), ["customers", "orders", "revenue", "quantity", "customer_share_pct", "known_customer_revenue_share_pct", "aov"]);
analysis.getRange("A1").values = [["SQL Analysis Tables"]];
analysis.getRange("A1").format.font = { name: "Arial", size: 15, bold: true, color: colors.navy };
analysis.getRange("A3").write(monthlyAnalysis);
analysis.tables.add(analysis.getRange("A3").getCurrentRegion(), true, "MonthlyTrendTable").style = "TableStyleMedium2";
analysis.getRange("H3").write(productAnalysis.slice(0, 16));
analysis.tables.add(analysis.getRange("H3").getCurrentRegion(), true, "TopProductTable").style = "TableStyleMedium2";
analysis.getRange("A33").write(countryAnalysis.slice(0, 16));
analysis.tables.add(analysis.getRange("A33").getCurrentRegion(), true, "TopCountryTable").style = "TableStyleMedium2";
analysis.getRange("I33").write(repeatAnalysis);
analysis.tables.add(analysis.getRange("I33").getCurrentRegion(), true, "RepeatBehaviorTable").style = "TableStyleMedium2";
analysis.getRange("A52").write(customerAnalysis.slice(0, 16));
analysis.tables.add(analysis.getRange("A52").getCurrentRegion(), true, "TopCustomerTable").style = "TableStyleMedium2";
analysis.getRange("A3:Q70").format.font = { name: "Arial", size: 9, color: colors.ink };
analysis.getRange("A:Q").format.autofitColumns();
analysis.freezePanes.freezeRows(3);

// Validation table, linked to source-derived workbook data.
const rawProfile = typed(await csv("raw_data_profile.csv", analysisDir), ["raw_records", "raw_orders", "raw_customers", "missing_customer_id_rows", "cancelled_rows", "nonpositive_quantity_rows", "nonpositive_price_rows", "missing_description_rows"]);
validation.getRange("A2").values = [["Resume Metrics Validation"]];
validation.getRange("A2").format.font = { name: "Arial", size: 15, bold: true, color: colors.navy };
validation.getRange("A4:E4").values = [["Resume claim", "Definition", "Calculated result", "Verdict", "Notes"]];
validation.getRange("A4:E4").format = { fill: colors.navy, font: { name: "Arial", size: 9, bold: true, color: colors.white }, horizontalAlignment: "center" };
validation.getRange("A5:B10").values = [
  ["1.06M+ transaction records", "Raw line-item rows across both sheets"],
  ["£20.4M+ revenue", "SUM(Quantity × Price) after cleaning"],
  ["40K+ orders", "Distinct valid invoices after cleaning"],
  ["5.9K customers", "Distinct non-null Customer IDs after cleaning"],
  ["72% repeat purchase rate", "Customers with ≥2 distinct orders ÷ known customers"],
  ["£511 AOV", "Clean revenue ÷ distinct clean orders"],
];
validation.getRange("C5").values = [[Number(rawProfile[1][0])]];
validation.getRange("C6").formulas = [[`=VLOOKUP("All|All|All",'KPI Cube'!$A$2:$J$${kpiEnd},5,FALSE)`]];
validation.getRange("C7").formulas = [[`=VLOOKUP("All|All|All",'KPI Cube'!$A$2:$J$${kpiEnd},6,FALSE)`]];
validation.getRange("C8").formulas = [[`=VLOOKUP("All|All|All",'KPI Cube'!$A$2:$J$${kpiEnd},7,FALSE)`]];
validation.getRange("C9").formulas = [[`=VLOOKUP("All|All|All",'KPI Cube'!$A$2:$J$${kpiEnd},9,FALSE)/100`]];
validation.getRange("C10").formulas = [[`=VLOOKUP("All|All|All",'KPI Cube'!$A$2:$J$${kpiEnd},8,FALSE)`]];
validation.getRange("D5:D10").values = [["Supported"], ["Supported"], ["Supported"], ["Supported when rounded"], ["Supported when rounded"], ["Supported when rounded"]];
validation.getRange("E5:E10").values = [["Raw count is 1,067,371."], ["Includes valid anonymous purchases; excludes cancellations, non-positive values, and exact duplicates."], ["One invoice is one order."], ["5,878 rounds to 5.9K."], ["4,255 of 5,878 known customers are repeat customers."], ["£510.92 rounds to £511."]];
validation.getRange("C5").format.numberFormat = "#,##0";
validation.getRange("C6").setNumberFormat('"£"#,##0.00');
validation.getRange("C7:C8").format.numberFormat = "#,##0";
validation.getRange("C9").format.numberFormat = "0.00%";
validation.getRange("C10").setNumberFormat('"£"#,##0.00');
validation.getRange("A4:E10").format.font = { name: "Arial", size: 10, color: colors.ink };
validation.getRange("A4:E4").format.font = { name: "Arial", size: 9, bold: true, color: colors.white };
validation.getRange("D5:D10").format = { fill: "#E8F3EC", font: { name: "Arial", size: 9, bold: true, color: "#276749" } };
validation.getRange("A:E").format.autofitColumns();
validation.getRange("B:B").format.columnWidth = 38;
validation.getRange("E:E").format.columnWidth = 62;
validation.getRange("A5:E10").format.wrapText = true;

const quality = JSON.parse(await fs.readFile(path.join(analysisDir, "validation_summary.json"), "utf8")).quality;
methodology.getRange("A2").values = [["Cleaning & Metric Methodology"]];
methodology.getRange("A2").format.font = { name: "Arial", size: 15, bold: true, color: colors.navy };
methodology.getRange("A4:C4").values = [["Step", "Rule / definition", "Rows / result"]];
methodology.getRange("A4:C4").format = { fill: colors.navy, font: { name: "Arial", size: 9, bold: true, color: colors.white } };
methodology.getRange("A5:C13").values = [
  [1, "Combine both yearly sheets into one raw line-item table", quality.raw_records],
  [2, "Normalize text, dates, integer quantities, numeric prices, and Customer IDs", "Types validated"],
  [3, "Exclude invoices beginning with C (cancelled)", quality.cancelled_rows],
  [4, "Exclude Quantity ≤ 0", quality.nonpositive_quantity_rows],
  [5, "Exclude Price ≤ 0", quality.nonpositive_price_rows],
  [6, "Require nonblank invoice, stock code, country, and a valid invoice date", "Required fields"],
  [7, "Remove exact duplicates across the eight source columns", quality.exact_duplicates_removed_from_valid_population],
  [8, "Retain valid rows with missing Customer ID for sales KPIs", quality.missing_customer_id_clean],
  [9, "Final clean line-item records", quality.cleaned_records],
];
methodology.getRange("A15:B20").values = [
  ["Metric", "Definition"],
  ["Revenue", "SUM(Quantity × time-specific unit Price) on clean rows"],
  ["Orders", "COUNT(DISTINCT Invoice) on clean rows"],
  ["Customers", "COUNT(DISTINCT Customer ID), excluding null IDs"],
  ["Repeat purchase rate", "Known customers with at least 2 distinct clean invoices ÷ all known customers"],
  ["AOV", "Total clean revenue ÷ distinct clean invoices"],
];
methodology.getRange("A15:B15").format = { fill: colors.navy, font: { name: "Arial", size: 9, bold: true, color: colors.white } };
methodology.getRange("A4:C20").format.font = { name: "Arial", size: 10, color: colors.ink };
methodology.getRange("A4:C4").format.font = { name: "Arial", size: 9, bold: true, color: colors.white };
methodology.getRange("A15:B15").format.font = { name: "Arial", size: 9, bold: true, color: colors.white };
methodology.getRange("A:C").format.autofitColumns();
methodology.getRange("B:B").format.columnWidth = 78;
methodology.getRange("A4:C20").format.wrapText = true;

divider.getRange("B3").values = [["Internal dashboard data"]];
divider.getRange("B3").format.font = { name: "Arial", size: 15, bold: true, color: colors.navy };
divider.getRange("B5").values = [["The sheets to the right contain source-derived cubes used by the dashboard dropdowns and formulas."]];
divider.getRange("B5").format.font = { name: "Arial", size: 10, italic: true, color: colors.muted };

// Tab colors and final QA formatting.
dashboard.tabColor = colors.navy;
analysis.tabColor = colors.blue;
validation.tabColor = colors.gold;
methodology.tabColor = colors.olive;
divider.tabColor = colors.muted;
chartData.freezePanes.freezeRows(1);
wb.recalculate();

const preview = await wb.render({ sheetName: "Dashboard", range: "A1:T77", scale: 0.85, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const inspect = await wb.inspect({ kind: "workbook,sheet,table,drawing", maxChars: 8000, tableMaxRows: 3, tableMaxCols: 6 });
await fs.writeFile(path.join(project, "workbook_inspection.txt"), inspect.ndjson || String(inspect), "utf8");
const formulas = await wb.inspect({ kind: "formula", sheetId: "Dashboard", range: "A1:T76", maxChars: 6000, options: { maxResults: 100 } });
await fs.writeFile(path.join(project, "formula_inspection.txt"), formulas.ndjson || String(formulas), "utf8");

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(outputPath);
console.log(outputPath);
