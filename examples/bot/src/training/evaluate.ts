const PATTERN_1 =
  /\bval\s+(?<g1>\d+(?:\.\d+)?)/u; /** Validation losses mlx-lm printed, in order. Lines look like "iter 10: val 2.345 ...". */
/** Terminal colour codes, which mlx-lm writes around its labels. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

export function parseValLosses(output: string): number[] {
  const losses: number[] = [];
  for (const line of output.replace(ANSI, "").split("\n")) {
    const m = line.match(PATTERN_1);
    if (m?.[1]) {
      losses.push(Number(m[1]));
    }
  }
  return losses;
}

export interface PromotionInput {
  /** Loss of the model that is active now, if any. */
  activeLoss?: number | undefined;
  /** Validation loss before any training (the base model). */
  baseLoss: number;
  /** Lowest validation loss reached during training. */
  bestLoss: number;
  /** Smallest improvement over the base that counts. */
  minImprovement?: number | undefined;
}

export interface PromotionDecision {
  promote: boolean;
  reason: string;
}

/**
 * Promotes a fine-tuned model only when it is measurably better than the base
 * and than the model currently in use. A run that does not beat them is kept
 * as an artifact but never served.
 */
export function decidePromotion(input: PromotionInput): PromotionDecision {
  const margin = input.minImprovement ?? 0.01;
  if (!Number.isFinite(input.bestLoss)) {
    return { promote: false, reason: "no validation loss was reported" };
  }
  if (input.bestLoss > input.baseLoss - margin) {
    return {
      promote: false,
      reason: `validation loss ${input.bestLoss.toFixed(3)} did not improve on the base ${input.baseLoss.toFixed(3)} by ${margin}`,
    };
  }
  if (input.activeLoss !== undefined && input.bestLoss >= input.activeLoss) {
    return {
      promote: false,
      reason: `validation loss ${input.bestLoss.toFixed(3)} is not better than the active model ${input.activeLoss.toFixed(3)}`,
    };
  }
  return { promote: true, reason: "better than the base and the active model" };
}
