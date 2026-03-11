import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type ParsedTransactionWithMeta
} from "@solana/web3.js";

export interface DepositVerification {
  verified: boolean;
  amountLamports: number;
  fromAddress: string;
  txSignature: string;
}

export interface WithdrawalResult {
  txSignature: string;
  amountLamports: number;
  toAddress: string;
}

export class CryptoService {
  private connection: Connection;
  private escrowKeypair: Keypair;
  public readonly escrowAddress: string;

  constructor(
    rpcUrl?: string,
    escrowPrivateKey?: string
  ) {
    const url = rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    this.connection = new Connection(url, "confirmed");

    const keyStr = escrowPrivateKey ?? process.env.ESCROW_PRIVATE_KEY;
    if (!keyStr) {
      // Generate a devnet keypair if no key provided (for development)
      this.escrowKeypair = Keypair.generate();
      console.warn(
        `[CryptoService] No ESCROW_PRIVATE_KEY set. Generated ephemeral escrow: ${this.escrowKeypair.publicKey.toBase58()}`
      );
    } else {
      const secretKey = Uint8Array.from(JSON.parse(keyStr) as number[]);
      this.escrowKeypair = Keypair.fromSecretKey(secretKey);
    }

    this.escrowAddress = this.escrowKeypair.publicKey.toBase58();
  }

  /**
   * Verify that a deposit transaction was sent to the escrow wallet
   * with the expected amount from the expected sender.
   */
  async verifyDeposit(
    txSignature: string,
    expectedAmountLamports: number,
    fromAddress: string
  ): Promise<DepositVerification> {
    const tx = await this.connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      return { verified: false, amountLamports: 0, fromAddress, txSignature };
    }

    if (tx.meta?.err) {
      return { verified: false, amountLamports: 0, fromAddress, txSignature };
    }

    // Look for a SOL transfer to our escrow address
    const transfer = this.findSolTransfer(tx, fromAddress, this.escrowAddress);
    if (!transfer) {
      return { verified: false, amountLamports: 0, fromAddress, txSignature };
    }

    if (transfer.lamports < expectedAmountLamports) {
      return { verified: false, amountLamports: transfer.lamports, fromAddress, txSignature };
    }

    return {
      verified: true,
      amountLamports: transfer.lamports,
      fromAddress,
      txSignature
    };
  }

  /**
   * Send SOL from escrow wallet to a player's wallet address.
   */
  async sendWithdrawal(
    toAddress: string,
    amountLamports: number
  ): Promise<WithdrawalResult> {
    const toPubkey = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.escrowKeypair.publicKey,
        toPubkey,
        lamports: amountLamports
      })
    );

    const txSignature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.escrowKeypair]
    );

    return {
      txSignature,
      amountLamports,
      toAddress
    };
  }

  /**
   * Get escrow wallet SOL balance in lamports.
   */
  async getEscrowBalance(): Promise<number> {
    return this.connection.getBalance(this.escrowKeypair.publicKey);
  }

  /**
   * Look through parsed transaction instructions for a SOL transfer
   * from `fromAddress` to `toAddress`.
   */
  private findSolTransfer(
    tx: ParsedTransactionWithMeta,
    fromAddress: string,
    toAddress: string
  ): { lamports: number } | null {
    for (const instruction of tx.transaction.message.instructions) {
      if ("parsed" in instruction && instruction.program === "system") {
        const parsed = instruction.parsed as {
          type?: string;
          info?: { source?: string; destination?: string; lamports?: number };
        };
        if (
          parsed.type === "transfer" &&
          parsed.info?.source === fromAddress &&
          parsed.info?.destination === toAddress &&
          typeof parsed.info.lamports === "number"
        ) {
          return { lamports: parsed.info.lamports };
        }
      }
    }
    return null;
  }
}
