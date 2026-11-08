"use client";

import { MODELS, type AttestationReport } from "@pay/rail/browser";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWallet } from "../wallet/wallet-context";
import type { Msg } from "./conversation";
import s from "./chat.module.css";

const TIER: Record<string, string> = {
  tee: "end-to-end encrypted to an attested enclave",
  private: "Venice-hosted, not retained",
  anonymized: "third-party host, identity stripped",
};

function cost(usd?: number) {
  if (usd === undefined) return null;
  return usd < 0.001 ? "< $0.001" : `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}

export function Message({ m, attestation, onUnlock }: { m: Msg; attestation?: AttestationReport; onUnlock: () => void }) {
  const w = useWallet();
  const [showThinking, setShowThinking] = useState(false);
  const [showProof, setShowProof] = useState(false);

  if (m.role === "user") {
    return (
      <div className={s.user}>
        <div className={s.userBubble}>{m.text}</div>
      </div>
    );
  }

  const model = MODELS[m.modelKey];
  return (
    <div className={s.assistant}>
      {m.reasoning && (
        <button className={s.thinkingToggle} onClick={() => setShowThinking((v) => !v)} aria-expanded={showThinking}>
          {m.status === "streaming" && !m.text ? "Thinking…" : showThinking ? "Hide thinking" : "Show thinking"}
        </button>
      )}
      {showThinking && m.reasoning && <div className={s.thinking}>{m.reasoning}</div>}

      {m.text ? (
        <div className={s.md}>
          <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
        </div>
      ) : m.status === "streaming" && !m.reasoning ? (
        <div className={s.pending} aria-label="Waiting for the reply">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {m.status === "error" && (
        <div className={s.error}>
          {m.error?.text}
          {m.error?.code === "VENICE_402" && (
            <button className={s.inlineBtn} onClick={() => w.setCreditOpen(true)}>
              Add credit
            </button>
          )}
          {m.error?.code === "LOCKED" && (
            <button className={s.inlineBtn} onClick={onUnlock}>
              Unlock
            </button>
          )}
        </div>
      )}

      {(m.status === "done" || m.status === "stopped") && (
        <div className={s.meta}>
          <span>{model?.label.replace(" (TEE)", "")}</span>
          <span>{model ? TIER[model.tier] : ""}</span>
          {cost(m.costUsd) && <span>{cost(m.costUsd)}</span>}
          {m.status === "stopped" && <span>stopped</span>}
          {attestation && (
            <button className={`${s.verified} ${attestation.ok && !m.plaintextChunks ? "" : s.unverified}`} onClick={() => setShowProof((v) => !v)}>
              {attestation.ok && !m.plaintextChunks ? "Verified enclave" : "Verification issue"}
            </button>
          )}
        </div>
      )}

      {showProof && attestation && <Proof a={attestation} plaintextChunks={m.plaintextChunks ?? 0} />}
    </div>
  );
}

function Proof({ a, plaintextChunks }: { a: AttestationReport; plaintextChunks: number }) {
  const local = a.checks.filter((c) => c.by === "local");
  const server = a.checks.filter((c) => c.by === "server");
  return (
    <div className={s.proof}>
      <p className={s.proofLead}>
        Your message was encrypted in this browser to a key that, according to its attestation, lives only inside a hardware enclave ({a.teeHardware ?? "TEE"}
        {a.gpu ? ` + NVIDIA ${a.gpu}` : ""}, run by {a.teeProvider ?? "the provider"}). Before sending, we checked:
      </p>
      <div className={s.proofGroup}>Checked in your browser</div>
      <ul className={s.checks}>
        {local.map((c) => (
          <li key={c.name} className={c.status === "pass" ? s.pass : s.fail}>
            <span className={s.tick} aria-hidden>
              {c.status === "pass" ? "✓" : "✗"}
            </span>
            <span>
              <strong>{c.name}.</strong> {c.detail}
            </span>
          </li>
        ))}
        <li className={plaintextChunks === 0 ? s.pass : s.fail}>
          <span className={s.tick} aria-hidden>
            {plaintextChunks === 0 ? "✓" : "✗"}
          </span>
          <span>
            <strong>Reply was encrypted.</strong> {plaintextChunks === 0 ? "Every chunk of the reply arrived encrypted and was decrypted here." : `${plaintextChunks} chunk(s) arrived unencrypted.`}
          </span>
        </li>
      </ul>
      <div className={s.proofGroup}>Reported by Venice&apos;s verifier (not re-checked here)</div>
      <ul className={s.checks}>
        {server.map((c) => (
          <li key={c.name} className={c.status === "pass" ? s.pass : s.fail}>
            <span className={s.tick} aria-hidden>
              {c.status === "pass" ? "✓" : "✗"}
            </span>
            <span>
              <strong>{c.name}.</strong> {c.detail}
            </span>
          </li>
        ))}
      </ul>
      <p className={s.proofLead}>
        <strong>What this means.</strong> Nobody between you and that key can read your messages: not us, not your network, not the model
        host&apos;s operators. Intel&apos;s signature on the attestation is checked by Venice&apos;s verifier, not in your browser, so against
        Venice itself this relies on Venice reporting honestly.
      </p>
      <dl className={s.proofFacts}>
        <dt>Enclave key</dt>
        <dd>{a.signingAddress}</dd>
        <dt>Our nonce</dt>
        <dd>{a.nonce}</dd>
        {a.sourceRepo && (
          <>
            <dt>Gateway code</dt>
            <dd>
              <a href={`${a.sourceRepo.replace(/\.git$/, "")}/tree/${a.sourceCommit}`} target="_blank" rel="noreferrer">
                {a.sourceRepo.replace(/^https:\/\/github.com\//, "").replace(/\.git$/, "")}@{a.sourceCommit?.slice(0, 10)}
              </a>
            </dd>
          </>
        )}
        <dt>Attested at</dt>
        <dd>{new Date(a.fetchedAt).toLocaleTimeString()}</dd>
      </dl>
    </div>
  );
}
