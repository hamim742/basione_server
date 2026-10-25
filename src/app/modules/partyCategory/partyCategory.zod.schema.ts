import { z } from "zod";

const createPartyCategoryZodSchema = z.object({
  name: z.string({ message: "Naam is verplicht" }).min(1, { message: "Naam mag niet leeg zijn" }),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  age: z.coerce.number().optional().nullable(),
  isMilestone: z.boolean().optional(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  h1Title: z.string().optional().nullable(),
  introText: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  position: z.coerce.number().optional(),
});

const updatePartyCategoryZodSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  age: z.coerce.number().optional().nullable(),
  isMilestone: z.boolean().optional(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  h1Title: z.string().optional().nullable(),
  introText: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  position: z.coerce.number().optional(),
});

export const partyCategoryValidation = {
  createPartyCategoryZodSchema,
  updatePartyCategoryZodSchema,
};
