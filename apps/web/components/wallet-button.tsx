"use client";

import { useWallet } from "../lib/wallet";

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { connected, connecting, address, connect, disconnect, phantomInstalled } = useWallet();

  if (connected && address) {
    return (
      <div className="wallet-connected">
        <span className="wallet-address" title={address}>
          {truncateAddress(address)}
        </span>
        <button
          className="secondary-button wallet-disconnect-btn"
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      className="secondary-button wallet-connect-btn"
      onClick={() => void connect()}
      disabled={connecting}
    >
      {connecting
        ? "Connecting..."
        : phantomInstalled
          ? "Connect Wallet"
          : "Install Phantom"}
    </button>
  );
}
