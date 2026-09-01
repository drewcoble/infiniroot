export function getConfiguredSuperAdminEmails(): string[] {
  return (import.meta.env.VITE_SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item: string) => item.trim().toLowerCase())
    .filter(Boolean);
}
