"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } from "@solana/web3.js";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const solana = (window as unknown as { solana?: PhantomProvider }).solana;
  if (solana?.isPhantom) return solana;
  return null;
}

interface WalletContextValue {
  connected: boolean;
  connecting: boolean;
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendSol: (toAddress: string, lamports: number) => Promise<string>;
  phantomInstalled: boolean;
}

const WalletContext = createContext<WalletContextValue>({
  connected: false,
  connecting: false,
  address: null,
  connect: async () => {},
  disconnect: async () => {},
  sendSol: async () => "",
  phantomInstalled: false
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<PhantomProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const phantom = getPhantomProvider();
    setProvider(phantom);
    if (phantom?.publicKey) {
      setAddress(phantom.publicKey.toBase58());
    }
  }, []);

  useEffect(() => {
    if (!provider) return;
    const handleConnect = () => {
      if (provider.publicKey) setAddress(provider.publicKey.toBase58());
    };
    const handleDisconnect = () => setAddress(null);

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.off("connect", handleConnect);
      provider.off("disconnect", handleDisconnect);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    const phantom = provider ?? getPhantomProvider();
    if (!phantom) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    setConnecting(true);
    try {
      const result = await phantom.connect();
      setAddress(result.publicKey.toBase58());
      setProvider(phantom);
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const disconnect = useCallback(async () => {
    if (provider) {
      await provider.disconnect();
    }
    setAddress(null);
  }, [provider]);

  const sendSol = useCallback(async (toAddress: string, lamports: number): Promise<string> => {
    if (!provider?.publicKey) {
      throw new Error("Wallet not connected");
    }

    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta"
      ? "mainnet-beta"
      : "devnet";
    const connection = new Connection(clusterApiUrl(network), "confirmed");

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(provider.publicKey.toBase58()),
        toPubkey: new PublicKey(toAddress),
        lamports
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(provider.publicKey.toBase58());

    const result = await provider.signAndSendTransaction(transaction);
    return result.signature;
  }, [provider]);

  const value = useMemo((): WalletContextValue => ({
    connected: Boolean(address),
    connecting,
    address,
    connect,
    disconnect,
    sendSol,
    phantomInstalled: Boolean(provider)
  }), [address, connecting, connect, disconnect, sendSol, provider]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  return useContext(WalletContext);
}
