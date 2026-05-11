import { z } from "zod";

export const FOLDER_NAME_MAX = 255;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(FOLDER_NAME_MAX, `Name must be ${FOLDER_NAME_MAX} characters or fewer`)
  .refine((n) => !/[\\/]/.test(n), "Slashes are not allowed")
  .refine((n) => {
    for (let i = 0; i < n.length; i++) {
      const code = n.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) return false;
    }
    return true;
  }, "Control characters are not allowed")
  .refine((n) => n !== "." && n !== "..", "Reserved name");
