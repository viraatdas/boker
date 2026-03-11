"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../lib/wallet";
import { WalletButton } from "./wallet-button";
import { getEscrowInfo } from "../lib/api";
import { formatSol, solToLamports } from "@boker/shared";

interface CryptoTableCreateProps {
  onConfigReady: (config: {
    buyInLamports: number;
    escrowAddress: string;
  }) => void;
  disabled?: boolean;
}

const SOL_PRESETS = [
  { label: "0.01 SOL", sol: 0.01 },
  { label: "0.05 SOL", sol: 0.05 },
  { label: "0.1 SOL", sol: 0.1 },
  { label: "0.5 SOL", sol: 0.5 },
];

export function CryptoTableCreate({ onConfigReady, disabled }: CryptoTableCreateProps) {
  const { connected, address } = useWallet();
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [buyInSol, setBuyInSol] = useState(0.05);
  const [activePreset, setActivePreset] = useState(1);

  useEffect(() => {
    void getEscrowInfo().then((info) => {
      setCryptoEnabled(info.enabled);
      setEscrowAddress(info.escrowAddress);
    }).catch(() => {
      setCryptoEnabled(false);
    });
  }, []);

  useEffect(() => {
    if (escrowAddress) {
      onConfigReady({
        buyInLamports: solToLamports(buyInSol),
        escrowAddress
      });
    }
  }, [buyInSol, escrowAddress, onConfigReady]);

  if (!cryptoEnabled) {
    return (
      <div className="crypto-unavailable">
        <p className="empty-state">Crypto tables are not available on this server.</p>
      </div>
    );
  }

  return (
    <div className="crypto-create-panel">
      {!connected ? (
        <div className="crypto-wallet-prompt">
          <p style={{ marginBottom: "0.5rem", color: "var(--muted)" }}>
            Connect your Phantom wallet to create a crypto table.
          </p>
          <WalletButton />
        </div>
      ) : (
        <>
          <div className="crypto-wallet-status">
            <span className="crypto-connected-dot" />
            <span className="wallet-addr-small">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
          </div>

          <label>
            Buy-in amount (SOL)
            <div className="preset-row">
              {SOL_PRESETS.map((preset, i) => (
                <button
                  key={preset.label}
                  className={`preset-btn ${activePreset === i ? "active" : ""}`}
                  onClick={() => {
                    setActivePreset(i);
                    setBuyInSol(preset.sol);
                  }}
                  disabled={disabled}
                >
                  <span className="preset-label">{preset.label}</span>
                </button>
              ))}
            </div>
          </label>

          <label>
            Custom amount
            <input
              className="text-input"
              type="number"
              min={0.001}
              step={0.001}
              value={buyInSol}
              onChange={(e) => {
                setBuyInSol(Number(e.target.value));
                setActivePreset(-1);
              }}
              disabled={disabled}
            />
          </label>

          <div className="crypto-info-row">
            <span>Buy-in: {formatSol(solToLamports(buyInSol))}</span>
            <span>Blinds adapt to buy-in</span>
          </div>

          <p className="identity-hint">
            No AI bots allowed at crypto tables. Escrow: {escrowAddress?.slice(0, 8)}...
          </p>
        </>
      )}
    </div>
  );
}
