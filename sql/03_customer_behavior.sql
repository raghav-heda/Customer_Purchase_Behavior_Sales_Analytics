-- name: customer_metrics
WITH order_level AS (
    SELECT
        customer_id,
        invoice,
        MIN(invoice_date) AS order_date,
        SUM(revenue) AS order_value,
        SUM(quantity) AS order_quantity
    FROM clean_transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id, invoice
)
SELECT
    customer_id,
    COUNT(*) AS order_count,
    ROUND(SUM(order_value), 2) AS total_spend,
    ROUND(AVG(order_value), 2) AS average_order_value,
    SUM(order_quantity) AS total_quantity,
    MIN(order_date) AS first_purchase,
    MAX(order_date) AS last_purchase,
    CASE WHEN COUNT(*) >= 2 THEN 'Repeat' ELSE 'One-time' END AS customer_type,
    ROUND(100.0 * SUM(order_value) / SUM(SUM(order_value)) OVER (), 4) AS known_customer_revenue_share_pct,
    ROW_NUMBER() OVER (ORDER BY SUM(order_value) DESC) AS revenue_rank,
    ROUND(
        100.0 * SUM(SUM(order_value)) OVER (
            ORDER BY SUM(order_value) DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) / SUM(SUM(order_value)) OVER (), 2
    ) AS cumulative_known_revenue_pct
FROM order_level
GROUP BY customer_id
ORDER BY total_spend DESC;

-- name: repeat_vs_one_time
WITH customer_summary AS (
    SELECT
        customer_id,
        COUNT(DISTINCT invoice) AS orders,
        SUM(revenue) AS revenue,
        SUM(quantity) AS quantity
    FROM clean_transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
)
SELECT
    CASE WHEN orders >= 2 THEN 'Repeat' ELSE 'One-time' END AS customer_type,
    COUNT(*) AS customers,
    SUM(orders) AS orders,
    ROUND(SUM(revenue), 2) AS revenue,
    SUM(quantity) AS quantity,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS customer_share_pct,
    ROUND(100.0 * SUM(revenue) / SUM(SUM(revenue)) OVER (), 2) AS known_customer_revenue_share_pct,
    ROUND(SUM(revenue) / NULLIF(SUM(orders), 0), 2) AS aov
FROM customer_summary
GROUP BY customer_type
ORDER BY customers DESC;

-- name: purchase_frequency_distribution
WITH customer_frequency AS (
    SELECT customer_id, COUNT(DISTINCT invoice) AS orders
    FROM clean_transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
)
SELECT
    CASE
        WHEN orders = 1 THEN '1 order'
        WHEN orders BETWEEN 2 AND 3 THEN '2-3 orders'
        WHEN orders BETWEEN 4 AND 6 THEN '4-6 orders'
        WHEN orders BETWEEN 7 AND 12 THEN '7-12 orders'
        ELSE '13+ orders'
    END AS frequency_band,
    COUNT(*) AS customers,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS customer_share_pct,
    MIN(orders) AS min_orders,
    MAX(orders) AS max_orders
FROM customer_frequency
GROUP BY frequency_band
ORDER BY min_orders;

-- name: top_customer_concentration
WITH customer_revenue AS (
    SELECT customer_id, SUM(revenue) AS revenue
    FROM clean_transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
), ranked AS (
    SELECT
        customer_id,
        revenue,
        ROW_NUMBER() OVER (ORDER BY revenue DESC) AS revenue_rank,
        SUM(revenue) OVER () AS known_revenue
    FROM customer_revenue
)
SELECT
    'Top 10 customers' AS cohort,
    COUNT(*) AS customers,
    ROUND(SUM(revenue), 2) AS revenue,
    ROUND(100.0 * SUM(revenue) / MAX(known_revenue), 2) AS known_customer_revenue_share_pct
FROM ranked
WHERE revenue_rank <= 10
UNION ALL
SELECT
    'Top 20% of customers',
    COUNT(*),
    ROUND(SUM(revenue), 2),
    ROUND(100.0 * SUM(revenue) / MAX(known_revenue), 2)
FROM ranked
WHERE revenue_rank <= CAST((SELECT COUNT(*) * 0.20 FROM customer_revenue) AS INTEGER);

