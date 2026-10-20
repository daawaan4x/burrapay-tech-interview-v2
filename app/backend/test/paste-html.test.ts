import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { extractPasteText } from "../src/paste-html.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url));

[
  {
    id: "tgiS1Swl",
    firstCard:
      "Basculegion-F @ Focus Sash\nAbility: Swift Swim\n- Muddy Water\n- Protect\n- Ice Beam\n- Shadow Ball\nModest Nature",
    headings: [
      "Basculegion-F @ Focus Sash",
      "Sneasler @ White Herb",
      "Archaludon @ Leftovers",
      "Pelipper @ Damp Rock",
      "Swampert @ Swampertite",
      "Golisopod @ Golisopite",
    ],
  },
  {
    id: "VvVArqgO",
    firstCard:
      "Mawile @ Mawilite\nAbility: Hyper Cutter\n- Protect\n- Sucker Punch\n- Play Rough\n- Iron Head\nAdamant Nature",
    headings: [
      "Mawile @ Mawilite",
      "Sneasler @ White Herb",
      "Sinistcha @ Colbur Berry",
      "Farigiraf @ Sitrus Berry",
      "Rhyperior @ Wide Lens",
      "Gyarados @ Gyaradosite",
    ],
  },
].forEach(({ id, firstCard, headings }) => {
  test(`complete ${id} HTML yields card text in DOM order without page controls`, async () => {
    const text = await Effect.runPromise(
      extractPasteText(await fixture(`vrpaste-${id}-complete.html`)),
    );

    const cards = text.split("\n\n");

    assert.deepEqual(
      cards.map((card) => card.split("\n")[0]),
      headings,
    );
    assert.equal(cards[0], firstCard);
    assert.doesNotMatch(text, /Export Team|<|\r/);
  });
});

test("HTML entities are decoded without trimming extracted field whitespace", async () => {
  const html = (await fixture("vrpaste-tgiS1Swl-complete.html"))
    .toString()
    .replace('alt="Focus Sash"', 'alt="Harbor &amp; Coast"')
    .replace(">Muddy Water</span>", ">  Water &amp; Wind  </span>");

  const text = await Effect.runPromise(extractPasteText(Buffer.from(html)));

  assert.ok(text.startsWith("Basculegion-F @ Harbor & Coast\n"));
  assert.ok(text.includes("\n-   Water & Wind  \n"));
});

test("fresh-response HTML reports missing team markup", async () => {
  const error = await Effect.runPromise(
    Effect.flip(extractPasteText(await fixture("vrpaste-raw.html"))),
  );

  assert.equal(error._tag, "PasteExtractionError");
  assert.match(error.message, /extract team text/);
  assert.ok(error.cause instanceof Error);
  assert.match(error.cause.message, /page shell/);
});

test("an unrelated heading is not accepted as a team card", async () => {
  const error = await Effect.runPromise(
    Effect.flip(extractPasteText(Buffer.from("<h3>Welcome</h3><p>News</p>"))),
  );

  assert.equal(error._tag, "PasteExtractionError");
});
