import { z } from 'zod'

/**
 * Server-side operator settings. Local to one person on one machine (Constitution I) and never
 * committed — config/ is gitignored. A token is never part of this shape, and neither is the
 * search query: that belongs to the browser (localStorage) and arrives with each request.
 */
export const operatorConfigSchema = z.object({
  refreshIntervalMs: z.number().int().min(10_000).max(3_600_000).default(60_000),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
  runTimeoutMs: z.number().int().min(30_000).max(3_600_000).default(600_000),
  maxDiffBytes: z.number().int().min(10_000).max(10_000_000).default(400_000),
  reviewPromptPath: z.string().default('prompts/review.md'),
  rereviewPromptPath: z.string().default('prompts/re-review.md'),
  port: z.number().int().min(1024).max(65_535).default(4317),
  includeDraftsInBulk: z.boolean().default(false),
})

export type OperatorConfigInput = z.input<typeof operatorConfigSchema>

export const partialOperatorConfigSchema = operatorConfigSchema.partial()

export const DEFAULT_CONFIG = operatorConfigSchema.parse({})
