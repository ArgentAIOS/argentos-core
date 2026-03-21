/**
 * Smart Text-to-Speech Processor
 * Handles pattern-based transformations for natural speech output
 */

// Number to words conversion
const ones = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberToWords(num: number): string {
  if (num === 0) return "zero";
  if (num < 0) return "negative " + numberToWords(Math.abs(num));

  if (num < 20) return ones[num];
  if (num < 100) {
    return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
  }
  if (num < 1000) {
    return (
      ones[Math.floor(num / 100)] + " hundred" + (num % 100 ? " " + numberToWords(num % 100) : "")
    );
  }
  if (num < 1000000) {
    return (
      numberToWords(Math.floor(num / 1000)) +
      " thousand" +
      (num % 1000 ? " " + numberToWords(num % 1000) : "")
    );
  }
  if (num < 1000000000) {
    return (
      numberToWords(Math.floor(num / 1000000)) +
      " million" +
      (num % 1000000 ? " " + numberToWords(num % 1000000) : "")
    );
  }
  return (
    numberToWords(Math.floor(num / 1000000000)) +
    " billion" +
    (num % 1000000000 ? " " + numberToWords(num % 1000000000) : "")
  );
}

function centsToWords(cents: number): string {
  if (cents === 0) return "";
  if (cents < 20) return ones[cents];
  return tens[Math.floor(cents / 10)] + (cents % 10 ? " " + ones[cents % 10] : "");
}

/**
 * Convert currency like "$114.90" to "one hundred fourteen dollars and ninety cents"
 */
function convertCurrency(text: string): string {
  // Match $X.XX or $X,XXX.XX patterns
  const currencyRegex = /\$([0-9,]+)(?:\.(\d{2}))?/g;

  return text.replace(currencyRegex, (_match, dollars, cents) => {
    const dollarAmount = parseInt(dollars.replace(/,/g, ""), 10);
    const centAmount = cents ? parseInt(cents, 10) : 0;

    let result = numberToWords(dollarAmount) + " dollar" + (dollarAmount !== 1 ? "s" : "");

    if (centAmount > 0) {
      result += " and " + centsToWords(centAmount) + " cent" + (centAmount !== 1 ? "s" : "");
    }

    return result;
  });
}

/**
 * Convert percentages like "14%" to "fourteen percent"
 */
function convertPercentages(text: string): string {
  const percentRegex = /(\d+(?:\.\d+)?)\s*%/g;

  return text.replace(percentRegex, (_match, num) => {
    const value = parseFloat(num);
    if (Number.isInteger(value)) {
      return numberToWords(value) + " percent";
    }
    // Handle decimals like 0.75%
    const [whole, decimal] = num.split(".");
    const wholeNum = parseInt(whole, 10);
    return (
      (wholeNum > 0 ? numberToWords(wholeNum) + " point " : "") +
      decimal
        .split("")
        .map((d: string) => ones[parseInt(d, 10)] || "zero")
        .join(" ") +
      " percent"
    );
  });
}

/**
 * Convert standalone numbers with context awareness
 * e.g., "121.79" becomes "one hundred twenty one point seven nine"
 */
function convertNumbers(text: string): string {
  // Match decimal numbers not already processed (not preceded by $)
  const numberRegex = /(?<!\$)(?<![0-9])(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?![0-9])/g;

  return text.replace(numberRegex, (match, num) => {
    // Skip if it looks like a year (4 digits, 19xx or 20xx)
    if (/^(19|20)\d{2}$/.test(num)) return match;

    const cleanNum = num.replace(/,/g, "");

    if (cleanNum.includes(".")) {
      const [whole, decimal] = cleanNum.split(".");
      const wholeNum = parseInt(whole, 10);
      const wholeWords = wholeNum === 0 ? "zero" : numberToWords(wholeNum);
      const decimalWords = decimal
        .split("")
        .map((d: string) => ones[parseInt(d, 10)] || "zero")
        .join(" ");
      return wholeWords + " point " + decimalWords;
    }

    return numberToWords(parseInt(cleanNum, 10));
  });
}

/**
 * Pattern handler interface for extensibility
 */
export interface PatternHandler {
  name: string;
  description: string;
  enabled: boolean;
  transform: (text: string) => string;
}

/**
 * Built-in pattern handlers
 */
export const defaultPatternHandlers: PatternHandler[] = [
  {
    name: "currency",
    description: "Convert $X.XX to spoken currency",
    enabled: true,
    transform: convertCurrency,
  },
  {
    name: "percentages",
    description: "Convert X% to spoken percentages",
    enabled: true,
    transform: convertPercentages,
  },
  {
    name: "numbers",
    description: "Convert standalone numbers to words",
    enabled: false, // Off by default - can be verbose
    transform: convertNumbers,
  },
];

/**
 * Apply all enabled pattern handlers and dictionary replacements
 */
export function processTextForSpeech(
  text: string,
  dictionary: Array<{ term: string; replacement: string; enabled: boolean }>,
  patternHandlers: PatternHandler[] = defaultPatternHandlers,
): string {
  let result = text;

  // 1. Apply pattern handlers first (order matters)
  for (const handler of patternHandlers) {
    if (handler.enabled) {
      result = handler.transform(result);
    }
  }

  // 2. Apply simple dictionary replacements
  for (const entry of dictionary) {
    if (entry.enabled) {
      const regex = new RegExp(entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      result =
        regex.source === "\\$"
          ? result // Skip $ replacement since currency handler does it better
          : result.replace(regex, entry.replacement);
    }
  }

  return result;
}

// Export individual converters for testing
export { numberToWords, convertCurrency, convertPercentages, convertNumbers };
