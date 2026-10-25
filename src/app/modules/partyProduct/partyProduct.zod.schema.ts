import { z } from "zod";

const createPartyProductZodSchema = z.object({
  title: z.string({ message: "Titel is verplicht" }).min(1, { message: "Titel mag niet leeg zijn" }),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  price: z.coerce.number({ message: "Prijs is verplicht" }).min(0, { message: "Prijs moet positief zijn" }),
  priceInclVat: z.coerce.number().optional().nullable(),
  priceExclVat: z.coerce.number().optional().nullable(),
  vatRate: z.coerce.number().optional().default(0.21),
  sku: z.string().optional().nullable(),
  images: z.array(z.string()).optional().default([]),
  featuredImage: z.string().optional().nullable(),
  inStock: z.boolean().optional().default(true),
  stockQuantity: z.coerce.number().optional().default(100),
  ages: z.array(z.coerce.number()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  isUpsellOnly: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
});

const updatePartyProductZodSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  price: z.coerce.number().min(0).optional(),
  priceInclVat: z.coerce.number().optional().nullable(),
  priceExclVat: z.coerce.number().optional().nullable(),
  vatRate: z.coerce.number().optional(),
  sku: z.string().optional().nullable(),
  images: z.array(z.string()).optional(),
  featuredImage: z.string().optional().nullable(),
  inStock: z.boolean().optional(),
  stockQuantity: z.coerce.number().optional(),
  ages: z.array(z.coerce.number()).optional(),
  tags: z.array(z.string()).optional(),
  isUpsellOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
});

export const partyProductValidation = {
  createPartyProductZodSchema,
  updatePartyProductZodSchema,
};
