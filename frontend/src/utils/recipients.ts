import Papa from "papaparse";

export function parseRecipients(text: string) {
  const cells = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  }).data.flat();
  const addresses = cells
    .flatMap((cell) => cell.split(/[\s;,]+/))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

  return [...new Set(addresses)];
}
