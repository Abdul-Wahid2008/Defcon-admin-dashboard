'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AuditEntry,
  CheckType,
  OverviewData,
  Page,
  Participant,
  TeamDetail,
  TeamSummary,
} from './schemas';
import {
  apiMeta, apiOverview, apiListTeams, apiGetTeam, apiCreateTeam,
  apiUpdateTeam, apiDeleteTeam, apiLifecycleAction, apiListParticipants,
  apiAddParticipant, apiRemoveParticipant, apiRotateCredentials,
  apiRunHealthChecks, apiListAlerts, apiQueryAudit, apiGetSettings,
  apiUpdateSettings, apiDemoInject, apiDemoFailNext, apiDemoReseed,
  apiImportTeams, apiBulkEnvironmentAction,
} from './api-client';
import { POLLING_INTERVALS } from './config';

// ── Meta ──────────────────────────────────────────────────────────────────────

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: apiMeta,
    staleTime: 30_000,
    refetchInterval: 10_000, // source freshness in the banner
    refetchIntervalInBackground: false,
  });
}

// ── Overview ─────────────────────────────────────────────────────────────────

export function useOverview() {
  return useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn: apiOverview,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.grid?.some((t) => t.pending)
        ? POLLING_INTERVALS.PENDING
        : POLLING_INTERVALS.DEFAULT;
    },
    staleTime: 2_000,
  });
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export function useTeams(filters: Record<string, string | string[] | boolean | number | undefined> = {}) {
  return useQuery<Page<TeamSummary>>({
    queryKey: ['teams', filters],
    queryFn: () => apiListTeams(filters),
    refetchInterval: POLLING_INTERVALS.DEFAULT,
    staleTime: 2_000,
  });
}

export function useTeam(teamId: string | undefined) {
  return useQuery<TeamDetail>({
    queryKey: ['team', teamId],
    queryFn: () => apiGetTeam(teamId!),
    enabled: !!teamId,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.environment?.pending ? POLLING_INTERVALS.PENDING : POLLING_INTERVALS.DEFAULT;
    },
    staleTime: 1_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: { name: string; notes?: string; participantNames?: string[]; autoProvision?: boolean }; idempotencyKey?: string }) =>
      apiCreateTeam(body, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useImportTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiImportTeams,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useBulkEnvironmentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiBulkEnvironmentAction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, patch }: { teamId: string; patch: { name?: string; notes?: string; accountStatus?: 'active' | 'suspended' } }) =>
      apiUpdateTeam(teamId, patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, confirmName, idempotencyKey }: { teamId: string; confirmName: string; idempotencyKey?: string }) =>
      apiDeleteTeam(teamId, confirmName, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useLifecycleAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, action, idempotencyKey, confirmation }: { teamId: string; action: 'start' | 'stop' | 'reset'; idempotencyKey?: string; confirmation?: { reason: string; confirmTeamId: string } }) =>
      apiLifecycleAction(teamId, action, idempotencyKey, confirmation),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

// ── Participants ──────────────────────────────────────────────────────────────

export function useParticipants(teamId: string | undefined) {
  return useQuery<Participant[]>({
    queryKey: ['participants', teamId],
    queryFn: () => apiListParticipants(teamId!),
    enabled: !!teamId,
  });
}

export function useAddParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, name }: { teamId: string; name: string }) =>
      apiAddParticipant(teamId, name),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['participants', vars.teamId] });
    },
  });
}

export function useRemoveParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, participantId }: { teamId: string; participantId: string }) =>
      apiRemoveParticipant(teamId, participantId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['participants', vars.teamId] });
    },
  });
}

export function useRotateCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, participantId }: { teamId: string; participantId?: string }) =>
      apiRotateCredentials(teamId, participantId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['participants', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

export function useRunHealthChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => apiRunHealthChecks(teamId),
    onSuccess: (_, teamId) => {
      qc.invalidateQueries({ queryKey: ['team', teamId] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export function useAlerts(params: { status?: 'open' | 'resolved'; limit?: number } = {}) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => apiListAlerts(params),
    refetchInterval: POLLING_INTERVALS.DEFAULT,
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function useAudit(params: Record<string, string | string[] | number | undefined> = {}) {
  return useQuery<Page<AuditEntry>>({
    queryKey: ['audit', params],
    queryFn: () => apiQueryAudit(params),
    refetchInterval: 10_000,
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: apiGetSettings,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { competitionStatus?: string }) => apiUpdateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

// ── Demo ──────────────────────────────────────────────────────────────────────

export function useDemoInject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { teamId: string; serviceKey: string; checkType: CheckType; mode: 'fail' | 'clear'; detail?: string }) => apiDemoInject(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useDemoFailNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { teamId: string; action: string }) => apiDemoFailNext(body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.teamId] });
    },
  });
}

export function useDemoReseed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDemoReseed,
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
