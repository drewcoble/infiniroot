import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { ActionIcon, Button, Collapse, Group, Loader, Select, Stack, Text } from "@mantine/core";
import { Check, ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { api } from "@infinidata/api";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { copyToClipboard } from "../lib/clipboard";
import type { SeasonData } from "../lib/seasonData";
import { TeamInvitesCard } from "./TeamInvitesCard";

const WATCHING = "watching";

// The commissioner's invites: one league link (convex/infiniyoffs/
// members.ts) - each person picks their team or just watches - and who's
// in. The older per-team links fold away underneath.
export function LeagueInviteCard({
  seasonId,
  data,
}: {
  seasonId: Id<"seasons">;
  data: SeasonData;
}) {
  const token = useQuery(api.infiniyoffs.members.getLeagueInvite, { seasonId });
  const members = useQuery(api.infiniyoffs.members.listMembers, { seasonId });
  const createInvite = useMutation(api.infiniyoffs.members.createLeagueInvite);
  const revokeInvite = useMutation(api.infiniyoffs.members.revokeLeagueInvite);
  const setMemberTeam = useMutation(api.infiniyoffs.members.setMemberTeam);
  const removeMember = useMutation(api.infiniyoffs.members.removeMember);
  const [copied, setCopied] = useState(false);
  const [perTeam, setPerTeam] = useState(false);

  const url = token ? `${window.location.origin}/invite/${token}` : null;
  const copy = async () => {
    if (url && (await copyToClipboard(url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const teamName = new Map(data.teams.map((team) => [team.teamId as string, team.name]));
  const claimed = new Set((members ?? []).flatMap((m) => (m.teamId ? [m.teamId as string] : [])));
  const open = data.teams
    .filter((team) => !team.isMine && !claimed.has(team.teamId))
    .map((team) => team.name);
  const teamOptions = [
    ...data.teams.map((team) => ({ value: team.teamId as string, label: team.name })),
    { value: WATCHING, label: "Watching" },
  ];

  return (
    <>
      <div className={glass.card}>
        <Stack gap="sm" p={4}>
          <span className={glass.sectionLabel}>Invite league members</span>
          <Text size="sm" c="dimmed">
            One link for everyone: each person picks their team or just watches.
          </Text>
          {token === undefined ? (
            <Loader size="sm" />
          ) : url ? (
            <Group gap="xs" wrap="nowrap">
              <Button
                style={{ flex: 1 }}
                leftSection={copied ? <Check size={16} /> : <Copy size={16} />}
                onClick={() => void copy()}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button variant="default" onClick={() => void createInvite({ seasonId })}>
                New link
              </Button>
              <Button variant="subtle" color="red" onClick={() => void revokeInvite({ seasonId })}>
                Turn off
              </Button>
            </Group>
          ) : (
            <Button onClick={() => void createInvite({ seasonId })}>Create link</Button>
          )}

          {members && members.length > 0 && (
            <Stack gap={6}>
              <span className={glass.sectionLabel}>Members</span>
              {members.map((member) => (
                <Group key={`${member.userId}-${member.via}`} gap="xs" wrap="nowrap">
                  <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                    {member.name}
                  </Text>
                  {member.via === "link" ? (
                    <>
                      <Select
                        size="xs"
                        w={150}
                        aria-label={`${member.name}'s team`}
                        value={member.teamId ?? WATCHING}
                        allowDeselect={false}
                        data={teamOptions}
                        onChange={(value) =>
                          value &&
                          void setMemberTeam({
                            seasonId,
                            userId: member.userId,
                            teamId: value === WATCHING ? null : (value as Id<"seasonTeams">),
                          })
                        }
                      />
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => void removeMember({ seasonId, userId: member.userId })}
                      >
                        <X size={16} />
                      </ActionIcon>
                    </>
                  ) : (
                    <Text size="xs" c="dimmed" truncate maw={180}>
                      {teamName.get(member.teamId ?? "") ?? "?"} · team link
                    </Text>
                  )}
                </Group>
              ))}
              {open.length > 0 && (
                <Text size="xs" c="dimmed">
                  Open: {open.join(", ")}
                </Text>
              )}
            </Stack>
          )}

          <Button
            variant="subtle"
            size="xs"
            onClick={() => setPerTeam(!perTeam)}
            rightSection={perTeam ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            style={{ alignSelf: "flex-start" }}
          >
            Per-team links
          </Button>
        </Stack>
      </div>
      <Collapse in={perTeam}>
        <TeamInvitesCard seasonId={seasonId} />
      </Collapse>
    </>
  );
}
