"use client";

import { useCallback, useEffect, useState } from "react";
import { inferenceUsdc, veniceFor } from "../funding/flow";
import { useWallet } from "./wallet-context";

/** Venice credit + idle USDC on the inference wallet, refreshed every 30s while unlocked. */
export function useCredit() {
  const { inference } = useWallet();
  const [creditUsd, setCreditUsd] = useState<number | null>(null);
  const [idleUsdc, setIdleUsdc] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!inference) return;
    const [b, u] = await Promise.allSettled([veniceFor(inference).balance(), inferenceUsdc(inference.address)]);
    if (b.status === "fulfilled") setCreditUsd(b.value.balanceUsd);
    if (u.status === "fulfilled") setIdleUsdc(Number(u.value) / 1e6);
  }, [inference]);

  useEffect(() => {
    setCreditUsd(null);
    setIdleUsdc(null);
    if (!inference) return;
    void refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [inference, refresh]);

  return { creditUsd, idleUsdc, refresh };
}
