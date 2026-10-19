"use client";
import { useCallback, useEffect, useState } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
/** Personal defaults per drawing; assignments themselves are saved on the markup. */
export function useMeasurementLayers(sheetId?: string) {
  const account = useDrawingAccount()?.accountKey;
  const key = account && sheetId ? `foremanhq:measurement-layers:${account}:${sheetId}` : null;
  const [state,setState] = useState<{key:string|null;value:string[]}>({key,value:["General"]});
  useEffect(() => {
    let value = ["General"];
    try {
      const saved: unknown = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      if(Array.isArray(saved) && saved.length > 0 && saved.length <= 30 && saved.every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 80)) value = saved;
    } catch { /* Optional device preference. */ }
    setState({key,value});
  },[key]);
  const change = useCallback((value: string[]) => {
    setState({key,value});
    if(key)try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Keep in memory. */ }
  },[key]);
  return [state.key===key ? state.value : ["General"], change] as const;
}
