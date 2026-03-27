# aos-paypunch

Agent-native PayPunch connector — first-party reference implementation.

PayPunch is a multi-tenant time tracking platform for bookkeepers. Field workers log hours via mobile, bookkeepers approve timesheets, and data exports to QuickBooks.

- `timesheet.list` and `timesheet.get` browse timesheet entries.
- `timesheet.approve` and `timesheet.reject` manage the approval workflow.
- `employee.list`, `employee.get`, and `employee.create` manage the workforce.
- `company.list` and `company.get` browse client companies within a tenant.
- `export.quickbooks_iif` and `export.csv` generate payroll export files.
- `pay_period.list` and `pay_period.current` navigate pay periods.
- `report.hours_summary` and `report.overtime` generate analytics.

## Auth

The connector expects a PayPunch API key via `PAYPUNCH_API_KEY`.

Optional scope hints:

- `PAYPUNCH_TENANT_ID` to scope to a specific bookkeeper tenant.
- `PAYPUNCH_COMPANY_ID` to default to a specific client company.
- `PAYPUNCH_EMPLOYEE_ID` to preselect an employee scope.
- `PAYPUNCH_TIMESHEET_ID` to preselect a timesheet scope.

## Live Reads + Writes

This is a first-party connector with full live read and write support. Timesheet approval/rejection, employee creation, and all read operations hit the PayPunch API directly. Export commands generate files on demand.
