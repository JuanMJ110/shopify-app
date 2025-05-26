import prisma from "../db.server";

export async function verifyApiKey(apiKey, checkActiveStatus = false) {
  if (!apiKey) return null;

  const conditions = { apiKey };
  if (checkActiveStatus) {
    conditions.shipeuStatus = "active";
  }

  const session = await prisma.session.findFirst({
    where: conditions,
  });

  return session;
} 