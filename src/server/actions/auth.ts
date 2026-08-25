"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import { signUpOrganization } from "@/server/services/organizations";

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = {
    organizationName: String(formData.get("organizationName") ?? ""),
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };

  const result = await signUpOrganization(input);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  await signIn("credentials", {
    email: input.email,
    password: input.password,
    redirectTo: "/dashboard",
  });

  // signIn redirects; unreachable in practice.
  return {};
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately vague: telling the caller which half was wrong is an
      // account-enumeration oracle.
      return { error: "Email or password is incorrect" };
    }
    throw error; // NEXT_REDIRECT and friends must propagate
  }
  return {};
}

export async function signOutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}
