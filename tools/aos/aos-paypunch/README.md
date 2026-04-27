# aos-paypunch

Agent-native PayPunch connector for AOS.

PayPunch is treated here as a live read-only payroll/time-tracking surface. The connector exposes read commands for timesheets, employees, companies, pay periods, exports, and reports. It does not advertise approval, rejection, employee creation, or any other write command until a write bridge is implemented and verified.

## Commands

- `timesheet.list` and `timesheet.get` browse timesheet entries.
- `employee.list` and `employee.get` browse employees.
- `company.list` and `company.get` browse client companies.
- `export.quickbooks_iif` and `export.csv` read export payloads.
- `pay_period.list` and `pay_period.current` navigate pay periods.
- `report.hours_summary` and `report.overtime` read report payloads.

## Auth

The connector requires operator-controlled service keys:

- `PAYPUNCH_API_KEY`
- `PAYPUNCH_API_BASE_URL`

Optional operator-controlled scope defaults:

- `PAYPUNCH_TENANT_ID`
- `PAYPUNCH_COMPANY_ID`
- `PAYPUNCH_EMPLOYEE_ID`
- `PAYPUNCH_TIMESHEET_ID`
- `PAYPUNCH_PAY_PERIOD`

Local `PAYPUNCH_*` environment variables remain a development harness fallback only. Linked production systems should bind credentials through operator service keys.

## Readiness

`health` samples `timesheet.list` and `employee.list` when the required service keys are present. Company, pay-period, export, and report commands are implemented but not separately tenant-smoked in this repo.

Readiness truth:

- `live_backend_available: true`
- `live_read_available: true`
- `write_bridge_available: false`
- `scaffold_only: false`
