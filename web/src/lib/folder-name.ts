import { z } from "zod";

export const FOLDER_NAME_MAX = 255;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(FOLDER_NAME_MAX, `Name must be ${FOLDER_NAME_MAX} characters or fewer`)
  .refine((n) => !/[\\/]/.test(n), "Slashes are not allowed")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: validating user input
  .refine((n) => !/[\x00-\x1f\x7f]/.test(n), "Control characters are not allowed")
  .refine((n) => n !== "." && n !== "..", "Reserved name");
