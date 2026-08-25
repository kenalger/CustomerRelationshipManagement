import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { signInSchema } from "@/lib/validation/auth";
import type { Role } from "@/generated/prisma/enums";

// JWT sessions, not database sessions: the Credentials provider requires it,
// and it keeps organizationId on the token so tenant scoping needs no extra
// query on every request.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await db.user.findFirst({
          where: { email: parsed.data.email.toLowerCase(), deletedAt: null },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            passwordHash: true,
            organizationId: true,
          },
        });

        // Compare against a dummy hash when the user is missing so a failed
        // lookup and a wrong password take the same time.
        const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
        const ok = await bcrypt.compare(parsed.data.password, hash);
        if (!user || !user.passwordHash || !ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.organizationId = (user as { organizationId: string }).organizationId;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.organizationId = token.organizationId as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
});
