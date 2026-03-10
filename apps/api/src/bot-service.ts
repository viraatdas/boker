import { buildBotPrompt, buildBotView, fallbackBotDecision, parseBotDecision, type BotDecision, type BotPersonality, type TableState } from "@boker/shared";
import { getLegalActions } from "@boker/shared";

export class GeminiBotService {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite"
  ) {}

  async decide(table: TableState, botGuestId: string, personality?: BotPersonality): Promise<BotDecision> {
    const legal = getLegalActions(table, botGuestId);
    if (!legal) {
      return { action: "check" };
    }

    const fallback = this.normalizeDecision(fallbackBotDecision(table, botGuestId, personality), legal);
    if (!this.apiKey) {
      return fallback;
    }

    try {
      const prompt = buildBotPrompt(buildBotView(table, botGuestId), personality);
      const startedAt = Date.now();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        console.error("Gemini error", response.status, await response.text());
        return fallback;
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      const parsed = parseBotDecision(raw);
      const normalized = parsed ? this.normalizeDecision(parsed, legal) : fallback;
      console.info("bot decision latency_ms", Date.now() - startedAt);
      return normalized;
    } catch (error) {
      console.error("Gemini request failed", error);
      return fallback;
    }
  }

  private normalizeDecision(decision: BotDecision, legal: NonNullable<ReturnType<typeof getLegalActions>>): BotDecision {
    switch (decision.action) {
      case "check":
        return legal.canCheck ? { action: "check" } : legal.callAmount ? { action: "call" } : { action: "fold" };
      case "call":
        return legal.callAmount ? { action: "call" } : legal.canCheck ? { action: "check" } : { action: "fold" };
      case "fold":
        return legal.canFold ? { action: "fold" } : { action: "check" };
      case "bet":
        if (!legal.betRange) {
          return legal.canCheck ? { action: "check" } : legal.callAmount ? { action: "call" } : { action: "fold" };
        }
        return {
          action: "bet",
          amount: clamp(decision.amount ?? legal.betRange.min, legal.betRange.min, legal.betRange.max)
        };
      case "raise":
        if (!legal.raiseRange) {
          return legal.callAmount ? { action: "call" } : legal.canCheck ? { action: "check" } : { action: "fold" };
        }
        return {
          action: "raise",
          amount: clamp(decision.amount ?? legal.raiseRange.min, legal.raiseRange.min, legal.raiseRange.max)
        };
      default:
        return legal.canCheck ? { action: "check" } : { action: "fold" };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
