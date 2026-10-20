# VR Pastes fixtures

19 October 2026

This folder keeps the HTML returned by a fresh request alongside snapshots
saved after the pages loaded in a browser. The two versions differ because
VR Pastes loads its team data through JavaScript and in a seperate hostname. Keeping both supports the offline tests required by [Task 2](../../../../EXAM.md#fetching-and-extraction) and records what the live HTTP response was missing.

## Investigation

Direct requests to both sample URLs returned `200` HTML responses containing
the page shell and metadata. Neither response contained team text or other pokemon details.

The site's JavaScript fetches data from
`https://vrpaste-backend.vercel.app/api/paste/{id}?lang=english`. That API
returned structured Pokemon records. However, the exam restricts fetching to `www.vrpastes.com` only

I attempted further inspection in the sources and for other possible webpages and endpoints, but I was not able to find any other pages that satisfy the current constraints.

## Saved files

| File | Source paste | What it contains |
| --- | --- | --- |
| [vrpaste-raw.html](./vrpaste-raw.html) | [tgiS1Swl](https://www.vrpastes.com/tgiS1Swl) | HTML from a fresh request, before browser JavaScript runs. |
| [vrpaste-tgiS1Swl-complete.html](./vrpaste-tgiS1Swl-complete.html) | [tgiS1Swl](https://www.vrpastes.com/tgiS1Swl) | The page's HTML structure after loading in a browser. |
| [vrpaste-VvVArqgO-complete.html](./vrpaste-VvVArqgO-complete.html) | [VvVArqgO](https://www.vrpastes.com/VvVArqgO) | The page's HTML structure after loading in a browser. |

The supplied snapshots have source-URL metadata matching the links above.

Each complete file contains six Pokemon cards. The filenames use "raw" for the initial HTML response and "complete" for the
loaded page's DOM.

## Decision and limits

The planned adapter uses ordinary HTTP requests. Headless rendering was left
out because the page needs an API on another hostname, and the assumption was that the exam's hostname restriction applies to that request as well.

The complete snapshots allow offline extraction checks against the rendered
cards. Supplying one as a mocked HTTP response assumes that fully loaded HTML
is available to the adapter. A normal fetch did not return that HTML during
the investigation, which is why the raw response is also kept.

Live imports will use the content actually fetched and return the applicable
error when extraction or validation fails. The fixtures will not replace a
failed live response. The exam allows representative fixtures when example
pastes are unavailable, provided the failure is documented. Passing tests with
these snapshots would still leave successful live extraction and support for
the sample URLs unverified.
