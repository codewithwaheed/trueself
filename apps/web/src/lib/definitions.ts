import { z } from "zod";

export const SignupFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters" })
    .trim(),
  email: z.string().email({ message: "Please enter a valid email" }).trim(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { message: "Must contain at least one letter" })
    .regex(/[0-9]/, { message: "Must contain at least one number" })
    .trim(),
  companyName: z
    .string()
    .min(2, { message: "Company name must be at least 2 characters" })
    .trim(),
});

export const LoginFormSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email" }).trim(),
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .trim(),
});

export const InviteFormSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email" }).trim(),
  name: z
    .string()
    .min(1, { message: "Name is required" })
    .trim(),
});

export const AcceptInviteFormSchema = z.object({
  token: z.string().min(1),
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters" })
    .trim(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { message: "Must contain at least one letter" })
    .regex(/[0-9]/, { message: "Must contain at least one number" })
    .trim(),
});

export type AuthFormState =
  | {
      errors?: Record<string, string[]>;
      message?: string;
      success?: boolean;
    }
  | undefined;
