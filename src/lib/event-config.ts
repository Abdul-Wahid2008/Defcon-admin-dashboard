import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Manifest + port formulas. Everything here is UNCONFIRMED (docs/12 C3, A23, A24); fail closed on bad config.
const ServiceEntry = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  portOffset: z.number().int().min(0),
  flagstores: z.literal(3), // UNCONFIRMED A24
  placeholder: z.boolean(),
  nameConfirmed: z.boolean(),
});

const EventConfig = z.object({
  ports: z.object({
    serviceBase: z.number().int().positive(),
    serviceStride: z.number().int().positive(),
    ttydBase: z.number().int().positive(),
    softTeamCap: z.number().int().positive(),
  }),
  terminalMode: z.enum(['per_team', 'shared']),
  services: z.array(ServiceEntry).min(1),
}).passthrough().superRefine((c, ctx) => {
  const dup = (vals: (string | number)[]) => new Set(vals).size !== vals.length;
  if (dup(c.services.map(s => s.key))) ctx.addIssue({ code: 'custom', message: 'duplicate service key' });
  if (dup(c.services.map(s => s.portOffset))) ctx.addIssue({ code: 'custom', message: 'duplicate portOffset' });
  if (c.services.some(s => s.portOffset >= c.ports.serviceStride)) {
    ctx.addIssue({ code: 'custom', message: 'portOffset must be < serviceStride' });
  }
});
export type EventConfigT = z.infer<typeof EventConfig>;
export type ServiceManifestEntry = EventConfigT['services'][number];

export function parseEventConfig(raw: unknown): EventConfigT {
  return EventConfig.parse(raw);
}

let cached: EventConfigT | undefined;
export function getEventConfig(): EventConfigT {
  cached ??= parseEventConfig(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'services.json'), 'utf8')),
  );
  return cached;
}

// MOCK/UNCONFIRMED A23: service = base + seq*stride + offset; ttyd = ttydBase + seq.
export function servicePort(seq: number, offset: number, c: EventConfigT = getEventConfig()): number {
  return c.ports.serviceBase + seq * c.ports.serviceStride + offset;
}
export function ttydPort(seq: number, c: EventConfigT = getEventConfig()): number {
  return c.ports.ttydBase + seq;
}
/** Non-fatal: the formulas are only documented for the first softTeamCap teams. */
export function teamCapWarning(seq: number, c: EventConfigT = getEventConfig()): string | null {
  return seq > c.ports.softTeamCap
    ? `team seq ${seq} exceeds ${c.ports.softTeamCap}: port formulas are unverified beyond that (A23)`
    : null;
}
