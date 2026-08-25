import { z } from "zod";

export const signUpSchema = z.object({
  organizationName: z.string().min(2, "Company name is required").max(100),
  name: z.string().min(1, "Your name is required").max(100),
  email: z.email("Enter a valid email").max(255),
  password: z.string().min(12, "Use at least 12 characters").max(200),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
