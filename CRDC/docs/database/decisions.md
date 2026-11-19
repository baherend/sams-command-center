# CRDC project decisions

This file records decisions and open items so contributors do not treat assumptions as center policy.

## Decided

| Topic | Decision | Basis |
|---|---|---|
| Current scope | Build the CRDC researcher portal and administration workflow. President's Office and comprehensive dashboard work are postponed. | Project steering from the user |
| Guide | Treat interactive guide v3 as an initial standalone deliverable. It may be integrated later, but that is not a prerequisite for the portal. | Project steering from the user |
| Request unit | Each thesis is its own request. Each paper sent for publication is a separate request. | Center guide distinguishes the two; user confirmed separate requests |
| Required services | Academic and professional degree requirements are represented separately from the service catalog. Statistical review and statistical analysis are distinct requirements. | Supplied Egyptian and foreign guides |
| Currency reporting | Show EGP and USD totals separately in the administration dashboard. | User decision |
| Consultancy | Keep the service inactive until the center supplies details. | No service details received |
| Real data | Use fictional sample data only in GitHub and development environments. Never commit personal researcher data, credentials, or private documents. | User decision and public repository |

## Assumptions awaiting confirmation

| Topic | Current draft assumption | Owner |
|---|---|---|
| Receipt grouping | A payment can cover multiple service items in one request; each payment belongs to one request and one currency. Payment amount must match the items linked to it. One item cannot have multiple payments. | Mr. Nader |
| Cross-request receipt | A receipt does not span thesis and paper requests. | Mr. Nader |
| Installments | Partial payment of one service item is not supported in the current draft. | Mr. Nader |
| Journal calendar | Do not treat the issue frequency or deadline seed values as confirmed. Store only verified issues and deadlines. | Journal sites / center |
| Publication acceptance | Whether postgraduate offices accept the center's acceptance letter or require a published paper remains open. | Mr. Nader |
| Staff visibility | Current RLS lets all active staff roles read operational rows. Confirm whether viewer/cashier roles should see researcher identifiers and all receipt details. | CRDC team |

Update this file when the center or team confirms an open item. Add the date and source of the confirmation.
