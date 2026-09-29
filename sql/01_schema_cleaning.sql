-- Customer Purchase Behavior & Sales Analytics
-- SQLite schema and reproducible cleaning logic

DROP TABLE IF EXISTS clean_transactions;

CREATE TABLE clean_transactions AS
WITH normalized AS (
    SELECT
        raw_id,
        TRIM(CAST(invoice AS TEXT)) AS invoice,
        TRIM(CAST(stock_code AS TEXT)) AS stock_code,
        NULLIF(TRIM(description), '') AS description,
        CAST(quantity AS INTEGER) AS quantity,
        datetime(invoice_date) AS invoice_date,
        CAST(unit_price AS REAL) AS unit_price,
        CAST(customer_id AS INTEGER) AS customer_id,
        TRIM(country) AS country,
        source_sheet,
        ROW_NUMBER() OVER (
            PARTITION BY
                TRIM(CAST(invoice AS TEXT)),
                TRIM(CAST(stock_code AS TEXT)),
                NULLIF(TRIM(description), ''),
                CAST(quantity AS INTEGER),
                datetime(invoice_date),
                CAST(unit_price AS REAL),
                CAST(customer_id AS INTEGER),
                TRIM(country)
            ORDER BY raw_id
        ) AS duplicate_rank
    FROM raw_transactions
), valid_rows AS (
    SELECT *
    FROM normalized
    WHERE invoice IS NOT NULL
      AND invoice <> ''
      AND UPPER(invoice) NOT LIKE 'C%'
      AND stock_code IS NOT NULL
      AND stock_code <> ''
      AND invoice_date IS NOT NULL
      AND quantity > 0
      AND unit_price > 0
      AND country IS NOT NULL
      AND country <> ''
      AND duplicate_rank = 1
)
SELECT
    raw_id,
    invoice,
    stock_code,
    description,
    quantity,
    invoice_date,
    unit_price,
    customer_id,
    country,
    source_sheet,
    quantity * unit_price AS revenue
FROM valid_rows;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clean_raw_id
    ON clean_transactions(raw_id);
CREATE INDEX IF NOT EXISTS idx_clean_invoice
    ON clean_transactions(invoice);
CREATE INDEX IF NOT EXISTS idx_clean_customer
    ON clean_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_clean_date
    ON clean_transactions(invoice_date);
CREATE INDEX IF NOT EXISTS idx_clean_country
    ON clean_transactions(country);
CREATE INDEX IF NOT EXISTS idx_clean_stock
    ON clean_transactions(stock_code);

DROP VIEW IF EXISTS vw_customer_order_counts;
CREATE VIEW vw_customer_order_counts AS
SELECT
    customer_id,
    COUNT(DISTINCT invoice) AS order_count,
    SUM(revenue) AS total_spend,
    SUM(quantity) AS total_quantity,
    MIN(invoice_date) AS first_purchase,
    MAX(invoice_date) AS last_purchase
FROM clean_transactions
WHERE customer_id IS NOT NULL
GROUP BY customer_id;

DROP VIEW IF EXISTS vw_clean_enriched;
CREATE VIEW vw_clean_enriched AS
SELECT
    t.*,
    CASE
        WHEN t.customer_id IS NULL THEN 'Unknown'
        WHEN c.order_count >= 2 THEN 'Repeat'
        ELSE 'One-time'
    END AS customer_type,
    strftime('%Y', t.invoice_date) AS invoice_year,
    strftime('%Y-%m', t.invoice_date) AS invoice_month
FROM clean_transactions t
LEFT JOIN vw_customer_order_counts c
    ON t.customer_id = c.customer_id;

