import { z } from "zod";

export const sizeSchema = z.object({
  width: z.number(),
  height: z.number()
});

export const videoEditorSchema = z.object({
  trackItemIds: z.array(z.string()),
  trackItemsMap: z.record(z.string(), z.any()),
  transitionsMap: z.record(z.string(), z.any()),
  fps: z.number(),
  size: sizeSchema,
  duration: z.number()
});

export type VideoEditorSchemaProps = z.infer<typeof videoEditorSchema>;