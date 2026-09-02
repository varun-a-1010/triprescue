import { defineRoute } from "@/lib/http";
import { status } from "@/lib/recovery/service";

export const GET = defineRoute({ name: "recovery.status", mutating: false }, (ctx) => status(ctx));
