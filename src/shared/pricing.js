// What reading an article costs on the Anthropic API, billed to the reader's
// own API credits. Prices are US dollars per million tokens, from Anthropic's
// price list. Thinking counts as output.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const priceOf = model => PRICES[model] ?? PRICES[String(model).replace(/-\d{8}$/, '')] ?? null;

// The cost of one reply, from the usage the API reports.
export function costOf(model, usage, fallbackModel) {
  const price = priceOf(model) ?? priceOf(fallbackModel);
  if (!price || !usage) return 0;
  const input =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * price.input + (usage.output_tokens ?? 0) * price.output) / 1e6;
}

// About what reading an article will cost: the notes, the lists and the
// bridges together. Measured on real articles with Claude Opus 5.5 (a
// 700-word post cost about 5¢, a 12,900-word essay about 66¢), an article takes
// about 3.9 input tokens and 1.7 output tokens a word, plus the instructions.
export function estimate(words, model) {
  const price = priceOf(model) ?? PRICES['claude-opus-5-5'];
  const input = 1800 + 3.9 * words;
  const output = 700 + 1.7 * words;
  return (input * price.input + output * price.output) / 1e6;
}

// "4¢", "65¢", "$1.40".
export function money(dollars) {
  if (dollars < 0.995) return `${Math.max(1, Math.round(dollars * 100))}¢`;
  return `$${dollars.toFixed(2)}`;
}
