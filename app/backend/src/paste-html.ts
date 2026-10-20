import { type CheerioAPI, loadBuffer } from "cheerio";
import * as Effect from "effect/Effect";
import { PasteExtractionError } from "./domain.ts";

type Selection = ReturnType<CheerioAPI>;

const extractFieldText = ($: CheerioAPI, field: Selection) => {
  if (field.find("ul").length)
    return field
      .find("li")
      .map((_, move) => `- ${$(move).text()}`)
      .get()
      .join("\n");

  // The view shows nature plus colored stat hints; retain the name only.
  if (field.children("span.ml-1").length)
    return `${field.children("span").first().text()} Nature`;

  return field.text();
};

const extractCardText = ($: CheerioAPI, heading: Selection) => {
  const card = heading.parent().parent().parent();
  const imagePanel = card.children("div.relative");
  const details = card.children("div").last();

  if (imagePanel.length !== 1 || details.find("ul").length !== 1)
    throw new Error("Unrecognized VR Pastes card markup");

  const name = imagePanel.find('img[loading="lazy"]').attr("alt");

  if (!name) throw new Error("VR Pastes card has no name");

  const item = imagePanel.find("div.rounded-full img").attr("alt");
  const lines = details
    .children()
    .map((_, field) => extractFieldText($, $(field)))
    .get();

  return [`${name}${item ? ` @ ${item}` : ""}`, ...lines].join("\n");
};

// The saved VR Pastes view has one card per h3, with an image panel and details.
// This adapter renders those DOM fields as text; it does not validate team text.
export const extractPasteText = (body: Buffer) =>
  Effect.try({
    try: () => {
      const $ = loadBuffer(body);
      const cards = $("h3")
        .map((_, heading) => extractCardText($, $(heading)))
        .get();

      if (!cards.length)
        throw new Error(
          "No team cards found; the response may contain only the page shell",
        );

      return cards.join("\n\n");
    },
    catch: (cause) =>
      new PasteExtractionError({
        message: "Could not extract team text from the VR Pastes HTML",
        cause,
      }),
  });
