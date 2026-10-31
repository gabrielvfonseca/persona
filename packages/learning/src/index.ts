import type { Outcome } from "./extract";
import { outcomeSignal, wasFailed, wasReplied } from "./extract";
import type { LearningStore } from "./store";
import {
  applyPatch,
  defaultLearningState,
  loadLearningState,
  mergeLearningState,
  saveLearningState,
} from "./store";

export type { DatasetEntry } from "@persona/core";
export type {
  DistillResult,
  EngineOptions,
} from "./engine";
export { LearningEngine } from "./engine";
export type { LearningSystemOptions } from "./system";
export {
  LearningSystem,
  noopFeedbackSink,
  noopLearningObserver,
} from "./system";
export type { LearningStore, Outcome };
export {
  applyPatch,
  defaultLearningState,
  loadLearningState,
  mergeLearningState,
  outcomeSignal,
  saveLearningState,
  wasFailed,
  wasReplied,
};
