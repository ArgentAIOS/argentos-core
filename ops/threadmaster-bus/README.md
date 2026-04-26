# Threadmaster Bus

The threadmaster bus is a durable local mailbox for active core threadmasters.

It is intentionally file-backed so messages survive restarts, show up in the worktree, and can be committed or inspected during handoff. Redis or another live transport can be added later, but this gives us the coordination guarantee without requiring a daemon.

## Commands

Post a message:

```sh
pnpm threadmaster:post --from workflows --to appforge --subject "Need event contract" --body "Please confirm the forge.review.completed payload fields before touching workflow resume logic."
```

List messages:

```sh
pnpm threadmaster:list --lane workflows
pnpm threadmaster:list --lane workflows --unacked
```

Ack a message:

```sh
pnpm threadmaster:ack --lane workflows --id tm-20260426071234-ab12cd
```

Show inbox counts:

```sh
pnpm threadmaster:status
```

Poll an inbox:

```sh
pnpm threadmaster:poll --lane workflows --interval 10
```

## Lanes

Known lane ids:

- `master`
- `workflows`
- `appforge`
- `aou`
- `aos`
- `openclaw`
- `all`

## Files

- `messages.jsonl` is created on first use and stores append-only messages.
- `acks.json` is created on first use and stores per-lane acknowledgements.

Do not put secrets in bus messages. Treat bus contents as repo-visible operational metadata.
