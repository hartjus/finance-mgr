# DOCUMENTATION ONLY!; NOT TO BE IMPLEMENTED


Analysis already shows monthly category totals, averages, cash flow, and category trends. I’d prioritize metrics that explain what changed and
  where to look next:

   Metric                                              What it tells the user
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Year-to-date income, expenses, and net cash flow    A quick overview before reading the detailed table.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Month-over-month change                             How spending and income changed, shown as both dollars and percentages.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Top spending categories                             The five largest categories and each category’s share of total expenses.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Largest category increases                          Which categories contributed most to higher spending compared with the previous month.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Budget variance                                     Planned versus actual spending, highlighting categories over budget.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Three-month average spending                        A smoother baseline for comparing the current month with recent activity.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Year-over-year comparison                           Whether spending changed versus the same month last year, accounting for seasonal patterns.
  ──────────────────────────────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────
   Largest transactions                                A short list of unusually large expenses, linking back to their ledger entries.

  I’d start with summary cards for income, expenses, net cash flow, and spending change, followed by top categories and largest category increases.

  A few calculation details matter:

  - Exclude account transfers from income and spending metrics. The current analysis query includes them.
  - Compare an incomplete month with the same elapsed portion of the prior period, or clearly label it “month to date.”
  - Include zero-spending months in averages when those months have complete records; exclude future months.
  - Rename the existing “General Spending” series to Net cash flow, since its calculation is credits minus debits.