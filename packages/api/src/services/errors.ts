import { TRPCError } from "@trpc/server";

/** Missing and other-organization records look the same to the caller. */
export function notFound(entity: string): never {
	throw new TRPCError({ code: "NOT_FOUND", message: `${entity} not found` });
}

export function conflict(message: string): never {
	throw new TRPCError({ code: "CONFLICT", message });
}

/** Postgres unique_violation. */
export function isUniqueViolation(error: unknown) {
	const cause = (error as { cause?: { code?: string } })?.cause ?? error;
	return (cause as { code?: string })?.code === "23505";
}

export function badRequest(message: string): never {
	throw new TRPCError({ code: "BAD_REQUEST", message });
}

export function forbidden(message = "Not allowed"): never {
	throw new TRPCError({ code: "FORBIDDEN", message });
}
