"""Build the SQLite model, cleaned extract, and analysis CSVs from Online Retail II."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sqlite3
from pathlib import Path

import pandas as pd


def parse_named_queries(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    parts = re.split(r"^-- name:\s*([A-Za-z0-9_]+)\s*$", text, flags=re.MULTILINE)
    return {parts[i]: parts[i + 1].strip() for i in range(1, len(parts), 2)}


def load_raw_workbook(source: Path, connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE IF EXISTS raw_transactions")
    first = True
    for sheet in pd.ExcelFile(source).sheet_names:
        frame = pd.read_excel(source, sheet_name=sheet)
        frame = frame.rename(
            columns={
                "Invoice": "invoice",
                "StockCode": "stock_code",
                "Description": "description",
                "Quantity": "quantity",
                "InvoiceDate": "invoice_date",
                "Price": "unit_price",
                "Customer ID": "customer_id",
                "Country": "country",
            }
        )
        frame["invoice"] = frame["invoice"].astype("string").str.strip()
        frame["stock_code"] = frame["stock_code"].astype("string").str.strip()
        frame["description"] = frame["description"].astype("string").str.strip()
        frame["country"] = frame["country"].astype("string").str.strip()
        frame["quantity"] = pd.to_numeric(frame["quantity"], errors="coerce").astype("Int64")
        frame["unit_price"] = pd.to_numeric(frame["unit_price"], errors="coerce")
        frame["customer_id"] = pd.to_numeric(frame["customer_id"], errors="coerce").astype("Int64")
        frame["invoice_date"] = pd.to_datetime(frame["invoice_date"], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S")
        frame["source_sheet"] = sheet
        frame.to_sql(
            "raw_transactions",
            connection,
            if_exists="replace" if first else "append",
            index=False,
            chunksize=10_000,
        )
        first = False
    connection.execute("ALTER TABLE raw_transactions ADD COLUMN raw_id INTEGER")
    connection.execute("UPDATE raw_transactions SET raw_id = rowid")
    connection.execute("CREATE UNIQUE INDEX idx_raw_id ON raw_transactions(raw_id)")
    connection.commit()


def export_named_queries(connection: sqlite3.Connection, sql_paths: list[Path], output_dir: Path) -> dict[str, list[dict]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    previews: dict[str, list[dict]] = {}
    for sql_path in sql_paths:
        for name, query in parse_named_queries(sql_path).items():
            frame = pd.read_sql_query(query, connection)
            frame.to_csv(output_dir / f"{name}.csv", index=False)
            previews[name] = frame.head(25).where(pd.notna(frame), None).to_dict(orient="records")
    return previews


def export_clean_data(connection: sqlite3.Connection, output_path: Path) -> None:
    query = """
        SELECT invoice, stock_code, description, quantity, invoice_date,
               unit_price, customer_id, country, revenue
        FROM clean_transactions
        ORDER BY invoice_date, invoice, raw_id
    """
    with gzip.open(output_path, "wt", encoding="utf-8", newline="") as handle:
        first = True
        for chunk in pd.read_sql_query(query, connection, chunksize=100_000):
            chunk.to_csv(handle, index=False, header=first)
            first = False


def build_dashboard_cubes(connection: sqlite3.Connection, output_dir: Path) -> None:
    """Build compact exact-summary tables that power Excel dropdown filters."""
    output_dir.mkdir(parents=True, exist_ok=True)
    data = pd.read_sql_query(
        """SELECT invoice, stock_code, description, quantity, revenue, customer_id,
                  country, customer_type, invoice_year, invoice_month
           FROM vw_clean_enriched""",
        connection,
    )
    data["customer_id"] = data["customer_id"].astype("Int64")
    years = ["All"] + sorted(data["invoice_year"].dropna().unique().tolist())
    countries = ["All"] + sorted(data["country"].dropna().unique().tolist())
    customer_types = ["All", "Repeat", "One-time", "Unknown"]
    kpi_frames, monthly_frames, product_frames, customer_frames, country_frames = [], [], [], [], []

    for include_year in (False, True):
        for include_country in (False, True):
            for include_type in (False, True):
                dims = []
                if include_year:
                    dims.append("invoice_year")
                if include_country:
                    dims.append("country")
                if include_type:
                    dims.append("customer_type")

                work = data.copy() if dims else data.assign(_all="All")
                group_dims = dims or ["_all"]
                kpi = work.groupby(group_dims, dropna=False).agg(
                    revenue=("revenue", "sum"),
                    orders=("invoice", "nunique"),
                    customers=("customer_id", "nunique"),
                    quantity=("quantity", "sum"),
                ).reset_index()
                known = work[work["customer_id"].notna()]
                frequency = known.groupby(group_dims + ["customer_id"], dropna=False)["invoice"].nunique().reset_index(name="customer_orders")
                repeat = frequency.groupby(group_dims, dropna=False).agg(
                    rate_customers=("customer_id", "count"),
                    repeat_customers=("customer_orders", lambda s: int((s >= 2).sum())),
                ).reset_index()
                kpi = kpi.merge(repeat, on=group_dims, how="left")
                kpi["aov"] = kpi["revenue"] / kpi["orders"].replace(0, pd.NA)
                kpi["repeat_rate_pct"] = 100 * kpi["repeat_customers"] / kpi["rate_customers"].replace(0, pd.NA)
                kpi["year_filter"] = kpi["invoice_year"] if include_year else "All"
                kpi["country_filter"] = kpi["country"] if include_country else "All"
                kpi["customer_type_filter"] = kpi["customer_type"] if include_type else "All"
                kpi_frames.append(kpi[["year_filter", "country_filter", "customer_type_filter", "revenue", "orders", "customers", "aov", "repeat_rate_pct", "quantity"]])

                monthly = work.groupby(group_dims + ["invoice_month"], dropna=False).agg(
                    revenue=("revenue", "sum"), quantity=("quantity", "sum"), orders=("invoice", "nunique")
                ).reset_index()
                monthly["year_filter"] = monthly["invoice_year"] if include_year else "All"
                monthly["country_filter"] = monthly["country"] if include_country else "All"
                monthly["customer_type_filter"] = monthly["customer_type"] if include_type else "All"
                monthly_frames.append(monthly[["year_filter", "country_filter", "customer_type_filter", "invoice_month", "revenue", "quantity", "orders"]])

                products = work.groupby(group_dims + ["stock_code"], dropna=False).agg(
                    description=("description", "max"), revenue=("revenue", "sum"),
                    quantity=("quantity", "sum"), orders=("invoice", "nunique")
                ).reset_index()
                products["description"] = products["description"].fillna("Unknown / Missing Description")
                products = products.sort_values(group_dims + ["revenue"], ascending=[True] * len(group_dims) + [False])
                products["rank"] = products.groupby(group_dims, dropna=False).cumcount() + 1
                products = products[products["rank"] <= 10]
                products["year_filter"] = products["invoice_year"] if include_year else "All"
                products["country_filter"] = products["country"] if include_country else "All"
                products["customer_type_filter"] = products["customer_type"] if include_type else "All"
                product_frames.append(products[["year_filter", "country_filter", "customer_type_filter", "rank", "stock_code", "description", "revenue", "quantity", "orders"]])

                customers_work = work[work["customer_id"].notna()]
                customers_ranked = customers_work.groupby(group_dims + ["customer_id"], dropna=False).agg(
                    revenue=("revenue", "sum"), orders=("invoice", "nunique")
                ).reset_index()
                customers_ranked = customers_ranked.sort_values(group_dims + ["revenue"], ascending=[True] * len(group_dims) + [False])
                customers_ranked["rank"] = customers_ranked.groupby(group_dims, dropna=False).cumcount() + 1
                customers_ranked = customers_ranked[customers_ranked["rank"] <= 10]
                customers_ranked["year_filter"] = customers_ranked["invoice_year"] if include_year else "All"
                customers_ranked["country_filter"] = customers_ranked["country"] if include_country else "All"
                customers_ranked["customer_type_filter"] = customers_ranked["customer_type"] if include_type else "All"
                customer_frames.append(customers_ranked[["year_filter", "country_filter", "customer_type_filter", "rank", "customer_id", "revenue", "orders"]])

    for include_year in (False, True):
        for include_type in (False, True):
            dims = []
            if include_year:
                dims.append("invoice_year")
            if include_type:
                dims.append("customer_type")
            work = data.copy() if dims else data.assign(_all="All")
            group_dims = dims or ["_all"]
            markets = work.groupby(group_dims + ["country"], dropna=False).agg(
                revenue=("revenue", "sum"), quantity=("quantity", "sum"), orders=("invoice", "nunique")
            ).reset_index()
            markets = markets.sort_values(group_dims + ["revenue"], ascending=[True] * len(group_dims) + [False])
            markets["rank"] = markets.groupby(group_dims, dropna=False).cumcount() + 1
            markets["year_filter"] = markets["invoice_year"] if include_year else "All"
            markets["customer_type_filter"] = markets["customer_type"] if include_type else "All"
            country_frames.append(markets[["year_filter", "customer_type_filter", "rank", "country", "revenue", "quantity", "orders"]])

    kpi_out = pd.concat(kpi_frames, ignore_index=True).fillna(0)
    monthly_out = pd.concat(monthly_frames, ignore_index=True)
    product_out = pd.concat(product_frames, ignore_index=True)
    customer_out = pd.concat(customer_frames, ignore_index=True)
    country_out = pd.concat(country_frames, ignore_index=True)

    behavior_frames = []
    for include_year in (False, True):
        for include_country in (False, True):
            dims = []
            if include_year:
                dims.append("invoice_year")
            if include_country:
                dims.append("country")
            known = data[data["customer_id"].notna()].copy()
            if not dims:
                known["_all"] = "All"
            group_dims = dims or ["_all"]
            by_customer = known.groupby(group_dims + ["customer_id"], dropna=False).agg(
                orders=("invoice", "nunique"), revenue=("revenue", "sum")
            ).reset_index()
            by_customer["customer_type"] = by_customer["orders"].map(lambda n: "Repeat" if n >= 2 else "One-time")
            behavior = by_customer.groupby(group_dims + ["customer_type"], dropna=False).agg(
                customers=("customer_id", "count"), revenue=("revenue", "sum"), orders=("orders", "sum")
            ).reset_index()
            behavior["year_filter"] = behavior["invoice_year"] if include_year else "All"
            behavior["country_filter"] = behavior["country"] if include_country else "All"
            behavior_frames.append(behavior[["year_filter", "country_filter", "customer_type", "customers", "revenue", "orders"]])

    behavior_out = pd.concat(behavior_frames, ignore_index=True)
    kpi_out.to_csv(output_dir / "dashboard_kpi_cube.csv", index=False)
    monthly_out.to_csv(output_dir / "dashboard_monthly_cube.csv", index=False)
    product_out.to_csv(output_dir / "dashboard_product_cube.csv", index=False)
    customer_out.to_csv(output_dir / "dashboard_customer_cube.csv", index=False)
    country_out.to_csv(output_dir / "dashboard_country_cube.csv", index=False)
    behavior_out.to_csv(output_dir / "dashboard_behavior_cube.csv", index=False)
    pd.DataFrame({"year": years}).to_csv(output_dir / "filter_years.csv", index=False)
    pd.DataFrame({"country": countries}).to_csv(output_dir / "filter_countries.csv", index=False)
    pd.DataFrame({"customer_type": customer_types}).to_csv(output_dir / "filter_customer_types.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--project", default=Path(__file__).resolve().parents[1], type=Path)
    parser.add_argument("--reuse-db", action="store_true", help="Reuse an already built raw/clean SQLite database")
    args = parser.parse_args()
    project = args.project.resolve()
    db_path = project / "data" / "online_retail_analytics.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    if not args.reuse_db:
        load_raw_workbook(args.source.resolve(), connection)
        connection.executescript((project / "sql" / "01_schema_cleaning.sql").read_text(encoding="utf-8"))
        connection.commit()
    previews = export_named_queries(
        connection,
        [project / "sql" / "02_kpi_sales_analysis.sql", project / "sql" / "03_customer_behavior.sql"],
        project / "analysis_outputs",
    )
    export_clean_data(connection, project / "data" / "cleaned_online_retail.csv.gz")
    build_dashboard_cubes(connection, project / "dashboard_data")

    quality = {
        "raw_records": connection.execute("SELECT COUNT(*) FROM raw_transactions").fetchone()[0],
        "valid_before_deduplication": connection.execute("""
            SELECT COUNT(*) FROM raw_transactions
            WHERE invoice IS NOT NULL AND TRIM(invoice) <> ''
              AND UPPER(TRIM(invoice)) NOT LIKE 'C%'
              AND stock_code IS NOT NULL AND TRIM(stock_code) <> ''
              AND datetime(invoice_date) IS NOT NULL
              AND quantity > 0 AND unit_price > 0
              AND country IS NOT NULL AND TRIM(country) <> ''
        """).fetchone()[0],
        "cleaned_records": connection.execute("SELECT COUNT(*) FROM clean_transactions").fetchone()[0],
        "missing_customer_id_raw": connection.execute("SELECT COUNT(*) FROM raw_transactions WHERE customer_id IS NULL").fetchone()[0],
        "missing_customer_id_clean": connection.execute("SELECT COUNT(*) FROM clean_transactions WHERE customer_id IS NULL").fetchone()[0],
        "cancelled_rows": connection.execute("SELECT COUNT(*) FROM raw_transactions WHERE UPPER(TRIM(invoice)) LIKE 'C%'").fetchone()[0],
        "nonpositive_quantity_rows": connection.execute("SELECT COUNT(*) FROM raw_transactions WHERE quantity <= 0").fetchone()[0],
        "nonpositive_price_rows": connection.execute("SELECT COUNT(*) FROM raw_transactions WHERE unit_price <= 0").fetchone()[0],
        "exact_duplicates_removed_from_valid_population": connection.execute("""
            SELECT (SELECT COUNT(*) FROM raw_transactions
                    WHERE invoice IS NOT NULL AND TRIM(invoice) <> ''
                      AND UPPER(TRIM(invoice)) NOT LIKE 'C%'
                      AND stock_code IS NOT NULL AND TRIM(stock_code) <> ''
                      AND datetime(invoice_date) IS NOT NULL
                      AND quantity > 0 AND unit_price > 0
                      AND country IS NOT NULL AND TRIM(country) <> '')
                 - (SELECT COUNT(*) FROM clean_transactions)
        """).fetchone()[0],
    }
    (project / "analysis_outputs" / "validation_summary.json").write_text(
        json.dumps({"quality": quality, "query_previews": previews}, indent=2, default=str),
        encoding="utf-8",
    )
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    connection.close()
    print(json.dumps(quality, indent=2))


if __name__ == "__main__":
    main()
