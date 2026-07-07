/**
 * Utility functions for advanced text normalization and search support in Firestore
 */

/**
 * Normalize text as required: uppercase, strip dots, hyphens, spaces, and other non-alphanumeric chars
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Generate sub-keywords of length 3 or more for substring/suffix searches
 */
export function generateSearchKeywords(plateNormalized: string, orderNoNormalized: string): string[] {
  const keywords = new Set<string>();

  const extractKeywordsFromWord = (word: string) => {
    if (!word || word.length < 3) return;
    
    // Add all contiguous substrings of length >= 3
    for (let len = 3; len <= word.length; len++) {
      for (let start = 0; start <= word.length - len; start++) {
        keywords.add(word.substring(start, start + len));
      }
    }
  };

  extractKeywordsFromWord(plateNormalized);
  extractKeywordsFromWord(orderNoNormalized);

  return Array.from(keywords);
}

/**
 * Build unified search fields structure for saving/updating a session
 */
export function getSearchFields(plateNumber: string, roNumber: string) {
  const pNorm = normalizeText(plateNumber);
  const oNorm = normalizeText(roNumber);
  const keywords = generateSearchKeywords(pNorm, oNorm);

  return {
    plateNormalized: pNorm,
    orderNoNormalized: oNorm,
    searchKeywords: keywords,
    searchIndexed: true
  };
}
