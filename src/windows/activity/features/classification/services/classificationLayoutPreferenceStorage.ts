import {
  readActivityKey,
  writeActivityKey,
} from "../../../../shared/activityStorageKeys";

export type MappingObjectMode = "app" | "web";

/* [T04-4] 键名从注册表取（老键字面量只住 activityStorageKeys.ts）；读写走出口（先过迁移闸）。 */

function isMappingObjectMode(value: string | null): value is MappingObjectMode {
  return value === "app" || value === "web";
}

export function readClassificationObjectMode(): MappingObjectMode {
  try {
    const value = readActivityKey("classificationObjectMode");
    return isMappingObjectMode(value) ? value : "app";
  } catch {
    return "app";
  }
}

export function rememberClassificationObjectMode(mode: MappingObjectMode) {
  try {
    writeActivityKey("classificationObjectMode", mode);
  } catch {
    // Classification layout preferences are best-effort; never block the interaction.
  }
}
