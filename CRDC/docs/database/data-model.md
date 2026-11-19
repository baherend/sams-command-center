# CRDC data model

## Scope and request shape

A request represents one piece of academic work. A thesis has its own request. Each paper submitted for publication has a separate request. One request can contain several service items, each with its own fee and status history.

The current model permits a payment to be linked to one or more service items in the same request. A payment cannot span requests or currencies. The linking function requires the payment amount to equal the total of the selected items. One service item cannot be split across multiple payments. These are implementation assumptions, not confirmed center policy; Mr. Nader has been asked to confirm the receipt workflow.

## Tables

| Group | Table | Purpose |
|---|---|---|
| Service catalog | services | Center services, including inactive consultancy |
| | requirement_types | Individual academic requirements, distinct from service types |
| | fee_schedule | Egyptian/foreign fee options and page-based pricing |
| | degrees | Academic/professional master's and PhD |
| | degree_requirements | Required items and counts for each degree |
| | journals | The two CRDC journals |
| | journal_issues | Known journal issue records and optional deadlines |
| | request_statuses | Shared status vocabulary |
| Accounts | researchers | Researcher identity/profile, linked to Supabase Auth |
| | staff_users | Center staff identity and role |
| Requests | service_requests | One thesis or paper request per work |
| | request_items | The services within a request and their fee snapshots |
| | request_status_history | Append-only status events for each service item |
| | payments | Payment orders and receipts associated with a request |
| Publication | publication_submissions | Journal, issue, language, and editorial decision for publication items |

## Main relationships

- researchers → service_requests → request_items → request_status_history
- service_requests → payments
- request_items → payments through payment_id; one payment may cover several items in the same request.
- request_items → publication_submissions → journals / journal_issues
- degrees → degree_requirements → requirement_types → services

Service status is tracked per request item rather than only at the request level. Fee values are copied into amount_due so later fee changes do not rewrite prior requests.

## Confirmed versus pending

Confirmed from the supplied guides:
- The fee schedules differ by Egyptian versus foreign applicant.
- Academic degrees require both statistical review and statistical analysis as separate items.
- Professional degrees require Digital Transformation only.
- Publication is a paper request, separate from the thesis request.

Pending:
- Whether one receipt can cover multiple services, whether multiple receipts can cover one request, and whether partial payment is allowed.
- The issue calendar and submission deadlines for both journals.
- Consultancy workflow and pricing.
- Whether postgraduate offices accept an acceptance letter or require the paper to be published.
