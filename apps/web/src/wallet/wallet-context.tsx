"use client";

import {
  DERIVATION_MESSAGE,
  NEP413_PARAMS,
  deriveInferenceKey,
  canonicalEvmSignature,
  isReproducibleEvmSignature,
  type SourceChain,
} from "@pay/rail/browser";
import { useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { hexToBytes, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { WagmiProvider, useSignMessage } from "wagmi";
import { evmSender, solanaSender, type DepositSender, type SolanaWallet } from "../funding/senders";
import { initAppKit, wagmiAdapter } from "./appkit";
import { nearConnector } from "./near";

initAppKit();
const queryClient = new QueryClient();

export type CreditTarget = { kind: "inference" } | { kind: "api"; address: string };

export interface LoginProof {
  challengeId: string;
  chain: SourceChain;
  address: string;
  signature: string;
  publicKey?: string;
}

export interface Source {
  chain: SourceChain;
  address: string;
}

interface WalletState {
  /** The user's own wallet (login + funding source). */
  source: Source | null;
  /** In-memory inference wallet; null until unlocked. Never persisted. */
  inference: LocalAccount | null;
  /** Same key as hex, only for the explicit "Use in your editor" reveal. Never persisted. */
  inferenceKey: `0x${string}` | null;
  busy: boolean;
  error: string | null;
  /** Sends a deposit from the connected wallet; null if this wallet type can't fund yet. */
  sender: DepositSender | null;
  /** The Add credit dialog, openable from anywhere (menu, chat errors). */
  creditOpen: boolean;
  setCreditOpen: (open: boolean) => void;
  /** Where Add credit delivers: the browser inference wallet (default) or the server API wallet. */
  creditTarget: CreditTarget;
  openCredit: (target?: CreditTarget) => void;
  /** Sign a server login challenge with the connected wallet. */
  signLogin: (c: { id: string; message: string; nonce: string; recipient: string }) => Promise<LoginProof>;
  connectEvmOrSolana: () => void;
  connectNear: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => void;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletStateProvider>{children}</WalletStateProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const evmVerifiedKey = (a: string) => `iw:evm-reproducible:${a.toLowerCase()}`;
const short = (k: string) => `${k.slice(0, 14)}…${k.slice(-4)}`;

function WalletStateProvider({ children }: { children: React.ReactNode }) {
  const { open } = useAppKit();
  const { disconnect: disconnectAppKit } = useDisconnect();
  const evm = useAppKitAccount({ namespace: "eip155" });
  const sol = useAppKitAccount({ namespace: "solana" });
  const { walletProvider: solProvider } = useAppKitProvider<
    { signMessage(m: Uint8Array): Promise<Uint8Array> } & SolanaWallet
  >("solana");
  const { connection: solConnection } = useAppKitConnection();
  const { signMessageAsync } = useSignMessage();

  const [nearAccount, setNearAccount] = useState<string | null>(null);
  const [inference, setInference] = useState<LocalAccount | null>(null);
  const [inferenceKey, setInferenceKey] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditTarget, setCreditTarget] = useState<CreditTarget>({ kind: "inference" });

  // Restore a NEAR session if the connector auto-connected.
  useEffect(() => {
    let off: (() => void) | undefined;
    nearConnector().then(async (c) => {
      const onIn = (e: { accounts: Array<{ accountId: string }> }) => setNearAccount(e.accounts[0]?.accountId ?? null);
      const onOut = () => setNearAccount(null);
      c.on("wallet:signIn", onIn);
      c.on("wallet:signOut", onOut);
      off = () => {
        c.off?.("wallet:signIn", onIn);
        c.off?.("wallet:signOut", onOut);
      };
      try {
        const w = await c.wallet();
        const accounts = await w.getAccounts();
        if (accounts[0]) setNearAccount(accounts[0].accountId);
      } catch {
        /* not connected */
      }
    });
    return () => off?.();
  }, []);

  const source: Source | null = useMemo(() => {
    if (evm.isConnected && evm.address) return { chain: "evm", address: evm.address };
    if (sol.isConnected && sol.address) return { chain: "sol", address: sol.address };
    if (nearAccount) return { chain: "near", address: nearAccount };
    return null;
  }, [evm.isConnected, evm.address, sol.isConnected, sol.address, nearAccount]);

  // A different (or no) source wallet means the old inference key must go.
  useEffect(() => {
    setInference(null);
    setInferenceKey(null);
    setError(null);
  }, [source?.chain, source?.address]);

  const signDerivation = useCallback(async (s: Source): Promise<Uint8Array> => {
    if (s.chain === "evm") {
      const sig = await signMessageAsync({ message: DERIVATION_MESSAGE });
      if (!isReproducibleEvmSignature(sig)) {
        throw new Error("This looks like a smart-contract wallet; its signatures change every time, so it can't recreate the same inference wallet. Use a regular wallet (MetaMask, Rabby, …), Solana or NEAR.");
      }
      // First unlock on this address: sign twice and compare, once, to prove it's reproducible.
      if (localStorage.getItem(evmVerifiedKey(s.address)) !== "1") {
        const again = await signMessageAsync({ message: DERIVATION_MESSAGE });
        if (again !== sig) throw new Error("This wallet signed the same message differently twice, so it can't safely recreate the inference wallet.");
        localStorage.setItem(evmVerifiedKey(s.address), "1");
      }
      return canonicalEvmSignature(hexToBytes(sig)); // same key whatever encoding the wallet returns
    }
    if (s.chain === "sol") {
      if (!solProvider) throw new Error("Solana wallet not ready");
      return solProvider.signMessage(new TextEncoder().encode(DERIVATION_MESSAGE));
    }
    const wallet = await (await nearConnector()).wallet();
    const signed = await wallet.signMessage({ ...NEP413_PARAMS, nonce: new Uint8Array(NEP413_PARAMS.nonce) });
    // A NEAR account has one key per device/wallet app, and each key gives a different inference
    // wallet. Remember which key unlocked last time and warn before switching to another one.
    const seenKey = `naisho:near-signer:${s.address}`;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(seenKey);
    } catch {}
    if (seen && seen !== signed.publicKey) {
      const ok = window.confirm(
        `This NEAR account signed with a different key than last time on this browser (${short(signed.publicKey)} instead of ${short(seen)}).\n\n` +
          "Each key unlocks a different inference wallet, so credit on the previous one is only reachable by signing with the previous key (the same wallet app or device). Continue with this key?",
      );
      if (!ok) throw new Error("Cancelled. Sign with the wallet app you used before to reach your existing credit.");
    }
    try {
      localStorage.setItem(seenKey, signed.publicKey);
    } catch {}
    return b64ToBytes(signed.signature);
  }, [signMessageAsync, solProvider]);

  const unlock = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const sig = await signDerivation(source);
      const key = deriveInferenceKey(sig, source);
      sig.fill(0);
      setInference(privateKeyToAccount(key));
      setInferenceKey(key);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [source, signDerivation]);

  const connectNear = useCallback(async () => {
    setError(null);
    try {
      const c = await nearConnector();
      const w = await c.connect();
      const accounts = await w.getAccounts();
      setNearAccount(accounts[0]?.accountId ?? null);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  }, []);

  const disconnect = useCallback(async () => {
    setInference(null);
    setInferenceKey(null);
    if (source?.chain === "near") {
      await (await nearConnector()).disconnect().catch(() => {});
      setNearAccount(null);
    } else {
      await disconnectAppKit().catch(() => {});
    }
  }, [source?.chain, disconnectAppKit]);

  const sender: DepositSender | null = useMemo(() => {
    if (source?.chain === "evm") return evmSender;
    if (source?.chain === "sol" && solProvider && solConnection) return solanaSender(solProvider, solConnection, source.address);
    return null; // NEAR funding: next step
  }, [source?.chain, source?.address, solProvider, solConnection]);

  const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  const signLogin = useCallback(
    async (c: { id: string; message: string; nonce: string; recipient: string }): Promise<LoginProof> => {
      if (!source) throw new Error("Connect a wallet first.");
      const base = { challengeId: c.id, chain: source.chain, address: source.address };
      if (source.chain === "evm") return { ...base, signature: await signMessageAsync({ message: c.message }) };
      if (source.chain === "sol") {
        if (!solProvider) throw new Error("Solana wallet not ready");
        return { ...base, signature: toB64(await solProvider.signMessage(new TextEncoder().encode(c.message))) };
      }
      const wallet = await (await nearConnector()).wallet();
      const nonce = Uint8Array.from(c.nonce.match(/../g)!.map((h) => parseInt(h, 16)));
      const signed = await wallet.signMessage({ message: c.message, recipient: c.recipient, nonce });
      return { ...base, signature: signed.signature, publicKey: signed.publicKey };
    },
    [source, signMessageAsync, solProvider],
  );

  const value: WalletState = {
    source,
    sender,
    creditOpen,
    setCreditOpen: (open: boolean) => {
      if (!open) setCreditTarget({ kind: "inference" });
      setCreditOpen(open);
    },
    creditTarget,
    openCredit: (target = { kind: "inference" }) => {
      setCreditTarget(target);
      setCreditOpen(true);
    },
    signLogin,
    inference,
    inferenceKey,
    busy,
    error,
    connectEvmOrSolana: () => void open({ view: "Connect" }),
    connectNear,
    unlock,
    lock: () => (setInference(null), setInferenceKey(null)),
    disconnect,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
