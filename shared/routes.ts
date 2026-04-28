import { z } from 'zod';
import { players, insertPlayerSchema, messageSchema, whatsappSendResponseSchema, whatsappStatusResponseSchema } from './schema.js';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
};

export const api = {
  players: {
    list: {
      method: 'GET' as const,
      path: '/api/players',
      input: z.object({
        level: z.string().optional(),
        search: z.string().optional(),
        profileTag: z.union([z.string(), z.array(z.string())]).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }).optional(),
      responses: {
        200: z.object({
          items: z.array(z.custom<typeof players.$inferSelect>()),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
          totalPages: z.number(),
        }),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/players',
      input: insertPlayerSchema,
      responses: {
        201: z.custom<typeof players.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/players/:id',
      input: insertPlayerSchema.partial(),
      responses: {
        200: z.custom<typeof players.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/players/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  whatsapp: {
    status: {
      method: 'GET' as const,
      path: '/api/whatsapp/status',
      responses: {
        200: whatsappStatusResponseSchema,
      },
    },
    send: {
      method: 'POST' as const,
      path: '/api/whatsapp/send',
      input: messageSchema,
      responses: {
        200: whatsappSendResponseSchema,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type PlayerResponse = z.infer<typeof api.players.list.responses[200]>["items"][number];
