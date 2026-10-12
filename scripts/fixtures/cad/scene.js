// @ts-nocheck
import { useModelScene as real } from "../../../src/components/models/use-model-scene";
export function useModelScene(...args) {
  const state = real(...args);
  window.test = state;
  return state;
}
