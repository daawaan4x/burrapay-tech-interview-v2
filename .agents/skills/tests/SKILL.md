---
name: tests
description: Design, write, review, tidy, and run concise backend tests with Node's test runner and optional ScyllaDB integration, within this repository's exam rules.
---

# Tests

Read [AGENTS.md](../../../AGENTS.md), [EXAM.md](../../../EXAM.md), and
[README.md](../../../README.md) for scope, authorship rules, contracts, and coding
conventions. Those files govern this skill; do not duplicate or override them.

Check authorship before proposing cases, fixtures, or fixes. Apply the
[candidate-owned work boundary](../../../AGENTS.md#candidate-owned-work) to
helpers, review suggestions, and handoffs as well as test files. If ownership is
unclear, resolve it before proceeding with the affected work.

- Read [principles.md](references/principles.md) for case design, assertions,
  fixtures, and Node/Fastify/Effect test setup.
- Also read [database.md](references/database.md) for driver adapters and real
  ScyllaDB tests.

Prioritize concise, readable tests and the smallest setup that establishes the
behavior. Keep structure simple and tidy existing permitted tests as you work;
remove unnecessary verbosity without weakening assertions or coverage.

Use README validation commands appropriate to the change and report what the
checks leave unverified.
