import { z } from '../tools/zodCompat.js'
import type { infer as zInfer, ZodSchema } from '../tools/zodCompat.js'

/** Bangumi 用户信息 Schema */
export const BgmUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  nickname: z.string().optional().default('') as ZodSchema<string>,
  avatar: z
    .object({
      large: z.string().optional(),
      medium: z.string().optional(),
      small: z.string().optional(),
    })
    .optional(),
})

export type BgmUser = zInfer<typeof BgmUserSchema>
