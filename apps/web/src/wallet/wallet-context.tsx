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
import { PublicKey } from "@solana/web3.js";
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { hexToBytes, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { WagmiProvider, useSignMessage } from "wagmi";
import { appFetch } from "../app/app-fetch";
import { evmSender, solanaSender, type DepositSender, type SolanaWallet } from "../funding/senders";
import { initAppKit, wagmiAdapter } from "./appkit";
import { nearConnector } from "./near";
import { askUser } from "./ask";
import { ConfirmHost } from "./confirm-host";
import { attemptGuard, recoverSigner, solanaSignatureValid, walletSession, walletUid, type WalletSession } from "./session";

initAppKit();
const queryClient = new QueryClient();

export type CreditTarget = { kind: "inference" } | { kind: "api"; address: string; uid: string };

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

export type ToolPanel = "keys" | "proxy" | null;

interface WalletState {
  /** The user's own wallet (login + funding source). */
  source: Source | null;
  /** In-memory inference wallet; null until unlocked. Never persisted. */
  inference: LocalAccount | null;
  /** Same key as hex, only for the explicit "Use in your editor" reveal. Never persisted. */
  inferenceKey: `0x${string}` | null;
  session: WalletSession;
  busy: boolean;
  error: string | null;
  /** Something the user should know while a wallet prompt is open. */
  notice: string | null;
  /** Which wallet the API-keys session belongs to, once known. */
  noteApiSession: (uid: string | null) => void;
  /** Give up on a wallet prompt that never answered. */
  cancelUnlock: () => void;
  /** Sends a deposit from the connected wallet; null if this wallet type can't fund yet. */
  sender: DepositSender | null;
  /** The Add credit dialog, openable from anywhere (menu, chat errors). */
  creditOpen: boolean;
  setCreditOpen: (open: boolean) => void;
  /** Where Add credit delivers: the browser inference wallet (default) or the server API wallet. */
  creditTarget: CreditTarget;
  openCredit: (target?: CreditTarget) => void;
  /** API keys / Local proxy dialogs, openable from anywhere (header, landing page, menu). */
  toolPanel: ToolPanel;
  setToolPanel: (p: ToolPanel) => void;
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
/** Asks once per account and signer, so a smart account or Ledger isn't prompted on every unlock. Throws if declined. */
async function confirmSigner(account: string, signer: string, question: string) {
  const key = `iw:signer-ok:${account}`;
  try {
    if (localStorage.getItem(key) === signer) return;
  } catch {}
  if (!(await askUser(question))) throw new Error("Cancelled. Check which account your wallet is using and try again.");
  try {
    localStorage.setItem(key, signer);
  } catch {}
}
const endApiSession = () => appFetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(5_000) }).catch(() => undefined);

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
  // One value, so the account and its key can't get out of step.
  const [unlocked, setUnlocked] = useState<{ account: LocalAccount; key: `0x${string}` } | null>(null);
  const [unlockAttempt] = useState(attemptGuard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditTarget, setCreditTarget] = useState<CreditTarget>({ kind: "inference" });
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);

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
  const currentSource = useRef<Source | null>(null);
  const apiSessionUid = useRef<string | null>(null);
  const noteApiSession = useCallback((uid: string | null) => void (apiSessionUid.current = uid), []);
  useEffect(() => {
    // Another wallet is connected now: the API-keys session was the old one's. Compared with the
    // wallet the session was issued to, so namespaces restoring on page load can't end it.
    if (source && apiSessionUid.current && walletUid(source) !== apiSessionUid.current) {
      apiSessionUid.current = null;
      void endApiSession();
    }
    currentSource.current = source;
    unlockAttempt.cancel();
    setBusy(false);
    setNotice(null);
    setUnlocked(null);
    setError(null);
  }, [source?.chain, source?.address, unlockAttempt]);

  const signDerivation = useCallback(async (s: Source): Promise<Uint8Array> => {
    if (s.chain === "evm") {
      const sig = await signMessageAsync({ message: DERIVATION_MESSAGE });
      if (!isReproducibleEvmSignature(sig)) {
        throw new Error("This looks like a smart-contract wallet; its signatures change every time, so it can't recreate the same inference wallet. Use a regular wallet (MetaMask, Rabby, …), Solana or NEAR.");
      }
      const signer = await recoverSigner(DERIVATION_MESSAGE, sig);
      if (signer && signer !== s.address.toLowerCase()) {
        // Not a hard stop: a smart account signing with its owner key is the right user, and may already hold credit.
        await confirmSigner(`evm:${s.address.toLowerCase()}`, signer, `This signature came from a different account than ${short(s.address)}. That's normal for some smart accounts; otherwise your wallet is using another account, which would create a different inference wallet.\n\nContinue?`);
      }
      // First unlock on this address: sign twice and compare, once, to prove it's reproducible.
      if (localStorage.getItem(evmVerifiedKey(s.address)) !== "1") {
        setNotice("One more signature, only this first time. It proves your wallet always gives the same inference wallet.");
        const again = await signMessageAsync({ message: DERIVATION_MESSAGE });
        if (again !== sig) throw new Error("This wallet signed the same message differently twice, so it can't safely recreate the inference wallet.");
        localStorage.setItem(evmVerifiedKey(s.address), "1");
      }
      return canonicalEvmSignature(hexToBytes(sig)); // same key whatever encoding the wallet returns
    }
    if (s.chain === "sol") {
      if (!solProvider) throw new Error("Solana wallet not ready");
      const message = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await solProvider.signMessage(message);
      if (!solanaSignatureValid(signature, message, new PublicKey(s.address).toBytes())) {
        // Not a hard stop: a Ledger signs a different format and is still the right owner.
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signature as BufferSource));
        await confirmSigner(`sol:${s.address}`, Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join(""), `This signature couldn't be confirmed as coming from ${short(s.address)}. That's normal for a Ledger; otherwise your wallet may have signed with another account, which would create a different inference wallet.\n\nContinue?`);
      }
      return signature;
    }
    const wallet = await (await nearConnector()).wallet();
    const signed = await wallet.signMessage({ ...NEP413_PARAMS, nonce: new Uint8Array(NEP413_PARAMS.nonce) });
    if (signed.accountId && signed.accountId.toLowerCase() !== s.address.toLowerCase()) {
      await confirmSigner(`near:${s.address}`, signed.accountId, `Your NEAR wallet signed as ${signed.accountId}, not ${s.address}. Signing as another account would create a different inference wallet.\n\nContinue?`);
    }
    // A NEAR account has one key per device/wallet app, and each key gives a different inference
    // wallet. Remember which key unlocked last time and warn before switching to another one.
    // Storage key predates the rename; kept so existing users arent warned again.
    const seenKey = `naisho:near-signer:${s.address}`;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(seenKey);
    } catch {}
    if (seen && seen !== signed.publicKey) {
      const ok = await askUser(
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
    const attempt = unlockAttempt.begin();
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const sig = await signDerivation(source);
      // The wallet changed while it was signing: this signature belongs to the old one. (A brief
      // reconnect back to the same wallet, common on mobile, still counts.)
      const now = currentSource.current;
      if (unlockAttempt.wasAbandoned(attempt) || now?.chain !== source.chain || now.address !== source.address) {
        sig.fill(0);
        return;
      }
      const key = deriveInferenceKey(sig, source);
      sig.fill(0);
      setUnlocked({ account: privateKeyToAccount(key), key });
    } catch (e) {
      if (unlockAttempt.isCurrent(attempt)) setError((e as Error).message ?? String(e));
    } finally {
      if (unlockAttempt.isCurrent(attempt)) {
        unlockAttempt.cancel();
        setBusy(false);
        setNotice(null);
      }
    }
  }, [source, signDerivation, unlockAttempt]);

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
    setUnlocked(null);
    try {
      // The API-keys session belongs to this wallet: it ends with it, or the next person inherits it.
      await endApiSession();
      apiSessionUid.current = null;
    } finally {
      if (source?.chain === "near") {
        await (await nearConnector()).disconnect().catch(() => {});
        setNearAccount(null);
      } else {
        await disconnectAppKit().catch(() => {});
      }
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
      // Never let "sign in" double as the key-deriving signature, whatever the server sends.
      if (c.message.includes(DERIVATION_MESSAGE) || !c.message.startsWith(`${window.location.host} wants you to sign in`) || (source.chain === "near" && c.recipient !== window.location.host)) {
        throw new Error("This sign-in request doesn't look right, so it wasn't signed.");
      }
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
    toolPanel,
    setToolPanel,
    signLogin,
    inference: unlocked?.account ?? null,
    inferenceKey: unlocked?.key ?? null,
    session: walletSession(!!source, !!unlocked, busy),
    busy,
    error,
    notice,
    noteApiSession,
    cancelUnlock: () => {
      unlockAttempt.abandon();
      setBusy(false);
      setNotice(null);
    },
    connectEvmOrSolana: () => void open({ view: "Connect" }),
    connectNear,
    unlock,
    lock: () => {
      unlockAttempt.abandon();
      setBusy(false);
      setUnlocked(null);
    },
    disconnect,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <ConfirmHost />
    </Ctx.Provider>
  );
}
