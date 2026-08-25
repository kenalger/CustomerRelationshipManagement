import { z } from "zod";

export const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "REP", "READ_ONLY"] as const;

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").max(255),
  // OWNER is deliberately absent: ownership transfers, it is not handed out.
  role: z.enum(ASSIGNABLE_ROLES),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(1, "Your name is required").max(100),
  password: z.string().min(12, "Use at least 12 characters").max(200),
});

export const changeRoleSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(ASSIGNABLE_ROLES),
});

export type InviteInput = z.infer<typeof inviteSchema>;
