-- Each named query can be run independently after 01_schema_cleaning.sql.

-- name: raw_data_profile
SELECT
    COUNT(*) AS raw_records,
    COUNT(DISTINCT invoice) AS raw_orders,
    COUNT(DISTINCT customer_id) AS raw_customers,
    SUM(CASE WHEN customer_id IS NULL THEN 1 ELSE 0 END) AS missing_customer_id_rows,
    SUM(CASE WHEN UPPER(TRIM(invoice)) LIKE 'C%' THEN 1 ELSE 0 END) AS cancelled_rows,
    SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) AS nonpositive_quantity_rows,
    SUM(CASE WHEN unit_price <= 0 THEN 1 ELSE 0 END) AS nonpositive_price_rows,
    SUM(CASE WHEN description IS NULL OR TRIM(description) = '' THEN 1 ELSE 0 END) AS missing_description_rows,
    MIN(invoice_date) AS first_transaction,
    MAX(invoice_date) AS last_transaction
FROM raw_transactions;

-- name: cleaned_kpis
WITH customer_frequency AS (
    SELECT customer_id, COUNT(DISTINCT invoice) AS orders
    FROM clean_transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
), kpi AS (
    SELECT
        COUNT(*) AS cleaned_records,
        SUM(revenue) AS total_revenue,
        COUNT(DISTINCT invoice) AS total_orders,
        COUNT(DISTINCT customer_id) AS total_customers,
        SUM(quantity) AS total_quantity
    FROM clean_transactions
)
SELECT
    cleaned_records,
    ROUND(total_revenue, 2) AS total_revenue,
    total_orders,
    total_customers,
    ROUND(total_revenue / NULLIF(total_orders, 0), 2) AS average_order_value,
    (SELECT COUNT(*) FROM customer_frequency WHERE orders >= 2) AS repeat_customers,
    ROUND(
        100.0 * (SELECT COUNT(*) FROM customer_frequency WHERE orders >= 2)
        / NULLIF((SELECT COUNT(*) FROM customer_frequency), 0), 2
    ) AS repeat_purchase_rate_pct,
    total_quantity
FROM kpi;

-- name: monthly_trends
SELECT
    invoice_month,
    ROUND(SUM(revenue), 2) AS revenue,
    SUM(quantity) AS quantity_sold,
    COUNT(DISTINCT invoice) AS orders,
    COUNT(DISTINCT customer_id) AS customers,
    ROUND(SUM(revenue) / NULLIF(COUNT(DISTINCT invoice), 0), 2) AS aov
FROM vw_clean_enriched
GROUP BY invoice_month
ORDER BY invoice_month;

-- name: yearly_trends
SELECT
    invoice_year,
    ROUND(SUM(revenue), 2) AS revenue,
    SUM(quantity) AS quantity_sold,
    COUNT(DISTINCT invoice) AS orders,
    COUNT(DISTINCT customer_id) AS customers,
    ROUND(SUM(revenue) / NULLIF(COUNT(DISTINCT invoice), 0), 2) AS aov
FROM vw_clean_enriched
GROUP BY invoice_year
ORDER BY invoice_year;

-- name: product_performance
SELECT
    stock_code,
    COALESCE(MAX(description), 'Unknown / Missing Description') AS product_description,
    ROUND(SUM(revenue), 2) AS revenue,
    SUM(quantity) AS quantity_sold,
    COUNT(DISTINCT invoice) AS orders,
    COUNT(DISTINCT customer_id) AS customers,
    ROUND(SUM(revenue) / NULLIF(SUM(quantity), 0), 2) AS realized_unit_price
FROM clean_transactions
GROUP BY stock_code
ORDER BY revenue DESC;

-- name: country_performance
SELECT
    country,
    ROUND(SUM(revenue), 2) AS revenue,
    SUM(quantity) AS quantity_sold,
    COUNT(DISTINCT invoice) AS orders,
    COUNT(DISTINCT customer_id) AS customers,
    ROUND(SUM(revenue) / NULLIF(COUNT(DISTINCT invoice), 0), 2) AS aov,
    ROUND(100.0 * SUM(revenue) / SUM(SUM(revenue)) OVER (), 2) AS revenue_share_pct
FROM clean_transactions
GROUP BY country
ORDER BY revenue DESC;

-- name: invoice_value_distribution
WITH order_values AS (
    SELECT invoice, SUM(revenue) AS order_value, SUM(quantity) AS order_quantity
    FROM clean_transactions
    GROUP BY invoice
)
SELECT
    COUNT(*) AS orders,
    ROUND(AVG(order_value), 2) AS mean_order_value,
    ROUND(MIN(order_value), 2) AS minimum_order_value,
    ROUND(MAX(order_value), 2) AS maximum_order_value,
    ROUND(AVG(order_quantity), 2) AS mean_order_quantity
FROM order_values;

