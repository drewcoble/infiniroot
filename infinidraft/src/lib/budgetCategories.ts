import type { SlotDescriptor } from "./rosterSlots";
import { CATEGORY_ORDER } from "../constants/budget";

export function categoryForSlot(
  slot: SlotDescriptor,
): (typeof CATEGORY_ORDER)[number] {
  if (
    slot.position === "QB" ||
    slot.position === "RB" ||
    slot.position === "WR" ||
    slot.position === "TE" ||
    slot.position === "DST" ||
    slot.position === "K"
  ) {
    return slot.position;
  }
  // FLEX/SUPERFLEX slots have a null position (see SlotDescriptor) - only
  // the label distinguishes them, and numbers when a league has more than
  // one ("FLEX1", "FLEX2", ...), hence startsWith rather than ===. Matches
  // the same convention slotAssignment.ts uses to find an open flex slot.
  if (slot.label.startsWith("FLEX")) return "FLEX";
  if (slot.label.startsWith("SFLEX")) return "SFLEX";
  return "BENCH";
}
