// Receipt vision parse: image -> proposed split, constrained to the taxonomy.
// Rules learned from real receipts: handwriting is authority; split by dept/item type
// otherwise; tax attaches to its items so the split sums to the charged total; flag
// genuinely-unclear items rather than guess.
const Anthropic = require('@anthropic-ai/sdk');
const cfg = require('./config');
const taxonomy = require('./taxonomy.json');

const taxoText = Object.entries(taxonomy.categories)
  .map(([c, subs]) => `- ${c}: ${subs.join(', ')}`).join('\n');

const SYSTEM = `You read a photo of a store receipt for Brian & Amanda Maucere's household budget and propose how to enter it, split by category when needed.

TAXONOMY — output ONLY these categories and their approved sub-categories:
${taxoText}
(Vacation sub-category is an open trip name. For grocery/food bought at a known store, the Food sub-category is the store name: Publix, Target, CVS, Costco, Sprouts, Whole Foods, Wal-Mart, ALDI, Amazon. Drinks/coffee/tea = Food/Drinks.)

HARD RULES (in priority order):
1. HANDWRITING IS THE AUTHORITY. Read any handwritten notes and let them override the printed items:
   - "All Food" / "all groceries" => do NOT split; one line for the whole total.
   - explicit splits like "Toilet 14.19" + "6.04 Food" => use those exact amounts and categories.
   - ratios like "Half gift / Half groceries" => split the total by that ratio.
   - "CASH" => set account to "Cash".
   - a person's initials/name ("AM"/"Amanda", "Sofia", "Brian") => use as the Clothing/School sub-category.
2. If no handwriting dictates it, decide whether a split is needed:
   - SPLIT when items span categories (e.g. Target GROCERY vs HEALTH & BEAUTY sections; Publix food + a supplement + houseware; Costco paper goods + food; gas + a snack).
   - DON'T split when everything is one category (a grocery-only Publix run, a hardware-only Lowe's trip, a clothing-only store).
3. TAX: attach sales tax to the taxed item(s) so the sum of the split lines EQUALS the grand total on the receipt.
4. FLAG, don't guess: if an item's category is genuinely unclear, still include the line but set "flag": true with a short question.
5. Use the receipt's grand total as "total". Extract the transaction date (printed anywhere, or handwritten) as YYYY-MM-DD.

Return ONLY this JSON (no prose):
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "total": number,
  "account": "Cash" or null,           // only if handwriting says cash; otherwise null (it's on a card)
  "needsSplit": boolean,
  "handwriting": "verbatim handwritten notes you saw, or empty",
  "lines": [ { "category": "...", "subcategory": "...", "amount": number, "note": "what these items are", "flag": false } ],
  "confidence": "high|med|low"
}
The lines' amounts MUST sum to total.`;

async function parse(base64, mediaType) {
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
        { type: 'text', text: 'Parse this receipt.' },
      ],
    }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

module.exports = { parse };
