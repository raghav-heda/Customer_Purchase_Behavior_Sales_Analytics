# Metrics Validation

## Canonical population

The validated KPI population contains exact-deduplicated rows that have a valid invoice, stock code, invoice date, country, positive quantity, positive price, and an invoice that does not begin with `C`. Missing Customer IDs are retained for sales metrics and excluded from customer metrics.

## Reproducible definitions

| Metric | Formula | Result |
|---|---|---:|
| Raw records | `COUNT(*)` across both source sheets | 1,067,371 |
| Cleaned records | `COUNT(*)` from `clean_transactions` | 1,007,913 |
| Revenue | `SUM(quantity * unit_price)` | £20,476,260.45 |
| Orders | `COUNT(DISTINCT invoice)` | 40,077 |
| Customers | `COUNT(DISTINCT customer_id)` excluding null IDs | 5,878 |
| AOV | Revenue ÷ distinct orders | £510.92 |
| Repeat customers | Known customers with at least 2 distinct orders | 4,255 |
| Repeat purchase rate | 4,255 ÷ 5,878 | 72.39% |
| Quantity sold | `SUM(quantity)` | 11,205,148 |

## Claim-by-claim assessment

| Resume claim | Assessment | Explanation |
|---|---|---|
| 1.06M+ retail transaction records | Supported | 1,067,371 raw line-item records |
| £20.4M+ revenue | Supported | £20,476,260.45 after documented cleaning |
| 40K+ orders | Supported | 40,077 distinct clean invoices |
| 5.9K customers | Supported when rounded | 5,878 distinct known customers rounds to 5.9K |
| 72% repeat purchase rate | Supported when rounded | 4,255 ÷ 5,878 = 72.39% |
| £511 AOV | Supported when rounded | £20,476,260.45 ÷ 40,077 = £510.92 |

## Sensitivity to Customer ID handling

| Population | Rows | Revenue | Orders | Customers | AOV | Repeat rate |
|---|---:|---:|---:|---:|---:|---:|
| Canonical: valid sales, including missing Customer ID | 1,007,913 | £20,476,260.45 | 40,077 | 5,878 known | £510.92 | 72.39% |
| Require Customer ID on every row | 779,425 | £17,374,804.27 | 36,969 | 5,878 | £469.98 | 72.39% |

The canonical population is preferred because Customer ID is not required to establish that a valid sale occurred. The customer-only population is used for behavioral analysis.

## Repeat purchase definition

The 72.39% metric is a **customer repeat rate**:

```text
Repeat purchase rate = customers with at least 2 distinct clean invoices
                       ---------------------------------------------------
                       all customers with a non-null Customer ID
```

This is not the percentage of orders placed by repeat customers, and it is not a cohort-retention rate. The SQL is available in `sql/02_kpi_sales_analysis.sql` and `sql/03_customer_behavior.sql`.

## Validation status

**Ready to share with documented caveats.** The headline calculations reconcile across SQL outputs and the Excel workbook. The main caveats are missing Customer IDs, partial boundary months, non-merchandise stock codes, and the retained positive adjustment invoice.

