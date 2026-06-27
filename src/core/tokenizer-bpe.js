// Accurate BPE tokenizer loader (GPT cl100k_base via gpt-tokenizer).
//
// Imported ONLY by the accurate build entry, so the ~2 MB rank tables are kept
// out of the default lean build. The gpt-tokenizer module itself is loaded
// lazily on first use.

let counter = null;

export async function loadBpeCounter() {
  if (!counter) {
    const { encode } = await import('gpt-tokenizer');
    counter = (text) => encode(text).length;
  }
  return counter;
}
