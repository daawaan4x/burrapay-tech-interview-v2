---
status: accepted
date: 2026-10-21
---

# Separate fetching from HTML extraction

Fetch paste responses through a dedicated HTTP adapter, then pass the bounded
body bytes to a separate Cheerio adapter for HTML decoding and text extraction.
Keeping network access outside Cheerio's loading APIs gives one place to enforce
the URL restrictions, rejected redirects, 10-second deadline, and 1 MiB limit in
[EXAM.md](../../EXAM.md#fetching-and-extraction).

Pass fetch and current-time functions through the existing application setup.
Production uses real dependencies; tests can supply controlled responses and
timestamps without changing globals or adding a dependency-injection framework.
The route coordinates two concurrent paste operations per request and preserves
participant order. 

## Consequences

The extractor depends on the site's card layout. It decodes HTML and produces
text with LF line endings, retaining field whitespace before parser normalization.
Missing or unrecognized cards produce an extraction failure. Layout changes can
be handled separately from network policy and resource cleanup.

Converting extracted text into Pokemon records remains candidate-owned under
[AGENTS.md](../../AGENTS.md#candidate-owned-work). This decision covers transport,
HTML extraction, and supporting wiring only.
