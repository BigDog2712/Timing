import { invokeWithCommandError } from "./commandError.ts";

const COMMIT_CLASSIFICATION_SETTINGS_COMMAND = "cmd_commit_classification_settings";

export interface ClassificationSettingMutation {
  key: string;
  value: string | null;
}

export async function commitClassificationSettingMutations(
  mutations: readonly ClassificationSettingMutation[],
): Promise<void> {
  if (mutations.length === 0) {
    return;
  }

  await invokeWithCommandError(COMMIT_CLASSIFICATION_SETTINGS_COMMAND, { mutations });
}
