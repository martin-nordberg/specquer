import { AGENT_GUIDE_FILE, hasAgentGuide, withAgentGuide } from "@specquer/shared/sections";
import type { FileService } from "../files.ts";

/**
 * The section anchor rules for coding agents in the root folder's `AGENTS.md`. Written only when
 * the user asks for it in **Add section anchors**.
 */

/** Whether `AGENTS.md` holds the rules. */
export async function hasAgentGuideFile(files: FileService): Promise<boolean> {
  if ((await files.fileStamp(AGENT_GUIDE_FILE)) === undefined) return false;
  try {
    return hasAgentGuide((await files.readFile(AGENT_GUIDE_FILE)).text);
  } catch {
    return false;
  }
}

/** Appends the rules to `AGENTS.md`, creating it if needed; does nothing if they are there. */
export async function addAgentGuideFile(files: FileService): Promise<void> {
  if ((await files.fileStamp(AGENT_GUIDE_FILE)) === undefined) {
    await files.create("", AGENT_GUIDE_FILE, "file", withAgentGuide(""));
    return;
  }
  const file = await files.readFile(AGENT_GUIDE_FILE);
  const text = withAgentGuide(file.text);
  if (text !== file.text) await files.saveFile(AGENT_GUIDE_FILE, text, file.version);
}
