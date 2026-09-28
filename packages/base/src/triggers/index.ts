/**
 * @fileType barrel
 * @domain triggers
 * @pattern triggers
 * @ai-summary Server barrel for the trigger engine.
 */
export { getTriggers, mutateTriggers, TRIGGERS_CONFIG_PATH, _resetTriggersConfigCache } from "./config";
export { triggerMatches, resolveActionData } from "./engine";
export { triggerSink } from "./sink";
export {
  setTriggerStateWriter,
  getTriggerStateWriter,
  type TriggerStateWrite,
  type TriggerStateWriter,
} from "./state-writer";
export {
  triggerConfigSchema,
  triggersFileSchema,
  TRIGGER_CONDITION_OPERATORS,
  type TriggerAction,
  type TriggerCondition,
  type TriggerConfig,
  type TriggersFile,
} from "./types";
