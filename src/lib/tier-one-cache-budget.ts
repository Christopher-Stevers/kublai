/** Serialized payload caps, excluding IndexedDB/browser metadata overhead. */
export const TIER_ONE_PAYLOAD_BUDGET = 20 * 1024 * 1024;
export const RECEIVING_READING_BUDGET = 256 * 1024;
export const RECEIVING_READING_ENTRY_BUDGET = 16 * 1024;
export const RECEIVING_READING_MAX_LINES = 32;
export const QUERY_PAYLOAD_BUDGET =
  TIER_ONE_PAYLOAD_BUDGET - RECEIVING_READING_BUDGET;
