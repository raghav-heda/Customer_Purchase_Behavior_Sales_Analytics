# Data Cleaning Documentation

## Source and grain

- File: `online_retail_II.xlsx`
- Sheets: `Year 2009-2010`, `Year 2010-2011`
- Raw rows: **1,067,371**
- Columns: **8**
- Date range: **2009-12-01 07:45:00 to 2011-12-09 12:50:00**
- Grain: one product / charge line within an invoice
- Countries: **43**

| Source column | SQLite field | Analytical type |
|---|---|---|
| Invoice | `invoice` | Text identifier |
| StockCode | `stock_code` | Text identifier |
| Description | `description` | Text |
| Quantity | `quantity` | Integer |
| InvoiceDate | `invoice_date` | Datetime text (`YYYY-MM-DD HH:MM:SS`) |
| Price | `unit_price` | Real |
| Customer ID | `customer_id` | Nullable integer |
| Country | `country` | Text |

## Raw quality findings

| Check | Result | Treatment |
|---|---:|---|
| Missing Customer IDs | 243,007 | Retained for sales if otherwise valid; excluded from customer metrics |
| Missing descriptions | 4,382 | All are removed by other validity rules; none remain clean |
| Cancelled invoice rows (`C%`) | 19,494 | Excluded |
| Quantity ≤ 0 | 22,950 | Excluded |
| Price ≤ 0 | 6,207 | Excluded |
| Exact duplicate rows in full raw data | 34,335 removable duplicates | Deduplicated |
| Invalid invoice dates | 0 | No remediation required |
| Blank invoices / stock codes / countries | Validated | Excluded if present |

Quality counts overlap and therefore must not be added together. After validity filters, 1,041,670 rows remain before deduplication. Removing 33,757 exact duplicates from that eligible population produces **1,007,913 clean rows**.

## SQL transformation sequence

The canonical logic is in `sql/01_schema_cleaning.sql`.

1. Trim text identifiers and categorical fields.
2. Cast quantity, price, Customer ID, and date to their analytical types.
3. Mark exact duplicates with `ROW_NUMBER()` across the eight original columns.
4. Exclude cancelled invoices with `UPPER(invoice) NOT LIKE 'C%'`.
5. Require `quantity > 0` and `unit_price > 0`.
6. Require nonblank invoice, stock code, country, and a valid date.
7. Keep only `duplicate_rank = 1`.
8. Calculate unrounded line revenue as `quantity * unit_price`; round only displayed aggregates.

## Customer ID policy

There are **228,488 otherwise-valid clean rows** without a Customer ID. These rows contribute:

- **3,108 orders**
- **£3,101,456.18 revenue**
- **15.15% of total cleaned revenue**

Dropping them would understate valid sales. Therefore:

- Sales KPIs use every clean transaction.
- Customer count, repeat rate, frequency, customer rankings, and customer revenue concentration use only non-null Customer IDs.

## Invoice validation

After cleaning, 1,007,912 rows have numeric invoice identifiers. One positive non-cancelled adjustment line has invoice `A563185`, stock code `B`, description `Adjust bad debt`, and revenue £11,062.06. It is retained in the headline methodology because it passes the explicit business rules and reproduces the validated resume metrics. The README documents the sensitivity if it is excluded.

## Product reporting caution

The source mixes merchandise with administrative or service stock codes such as `M`, `DOT`, and `POST`. These are retained in total revenue to preserve reconciliation. For merchandising decisions, filter these non-merchandise codes or report them in a separate category.

