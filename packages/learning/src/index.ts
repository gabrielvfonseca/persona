import type { LearningState } from "@persona/core";
import { LearningEngine } from "./engine";
import { LearningSystem, noopFeedbackSink, noopLearningObserver } from "./system";
import type { LearningStore } from "./store";
import {
  applyPatch,
  defaultLearningState,
  loadLearningState,
  mergeLearningState,
  saveLearningState,
} from "./store";
import { outcomeSignal, wasReplied, wasFailed } from "./extract";
import type { Outcome } from "./extract";

export {
  applyPatch,
  defaultLearningState,
  loadLearningState,
  mergeLearningState,
  saveLearningState,
  outcomeSignal,
  wasReplied,
  wasFailed,
};
export type { LearningStore, Outcome };

export type {
  DistillResult,
  EngineOptions,
} from "./engine";
export { LearningEngine } from "./engine";

export type { LearningSystemOptions } from "./system";
export { LearningSystem, noopFeedbackSink, noopLearningObserver } from "./system";

export type { DatasetEntry } from "@persona/core";