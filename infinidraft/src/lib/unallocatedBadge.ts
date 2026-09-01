// Shared label/color for the "$X unallocated" badge (BudgetTab.tsx's
// desktop badge and BudgetTab/UnallocatedBar.tsx's mobile bar) - budgeting
// more than the salary cap allows makes `unallocated` negative, which reads
// as "$X over" in red rather than a confusing "$-X unallocated".
export function unallocatedBadgeLabel(unallocated: number): string {
  return unallocated < 0
    ? `$${Math.abs(unallocated)} over`
    : `$${unallocated} unallocated`;
}

export function unallocatedBadgeColor(unallocated: number): string {
  if (unallocated < 0) return "red";
  return unallocated === 0 ? "green" : "yellow";
}
