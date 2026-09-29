# Interview Guide

## 30-second project explanation

I analyzed the Online Retail II dataset using SQLite and Excel. I combined two yearly sheets containing 1.067 million invoice lines, removed cancellations, non-positive quantities and prices, and exact duplicates, then calculated revenue at line level as quantity times price. The final sales population contains 1.008 million clean rows, £20.48 million revenue, and 40,077 orders. I separated sales logic from customer logic because 15.15% of revenue has no Customer ID. Among 5,878 known customers, 72.39% purchased more than once.

## Questions you should be ready to answer

### Why did you keep missing Customer IDs?

Customer ID is required for behavior analysis, but it is not required to prove that a valid sale occurred. Dropping those rows would remove £3.10 million of revenue and 3,108 orders. I kept them in sales KPIs and excluded them only from customer metrics.

### How did you calculate AOV?

I divided total cleaned revenue by distinct cleaned invoices: £20,476,260.45 ÷ 40,077 = £510.92.

### How did you define repeat purchase rate?

A repeat customer has at least two distinct cleaned invoices. There are 4,255 repeat customers out of 5,878 known customers, so the repeat rate is 72.39%.

### Why use `COUNT(DISTINCT invoice)`?

The dataset is at invoice-line grain. One invoice can contain many products, so counting rows would overstate orders.

### What was the most important data-quality issue?

Missing Customer IDs were the biggest analytical issue because they affect 22.67% of clean rows and 15.15% of revenue. I explicitly separated total-sales metrics from customer-attributed metrics.

### What would you improve next?

I would add a maintained product classification that separates merchandise, postage, fees, manual entries, and adjustments; create cohort retention and RFM segments; and automate anomaly alerts for unusually large quantities and order values.

## Strong SQL concepts demonstrated

- CTEs and reusable views
- `ROW_NUMBER()` for exact deduplication
- `CASE` for customer segmentation and frequency bands
- `COUNT(DISTINCT ...)` at order and customer grain
- Window functions for rankings, revenue shares, and cumulative concentration
- Subqueries for customer repeat-rate calculation
- Aggregations by month, year, product, country, and customer

