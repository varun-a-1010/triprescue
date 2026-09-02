import { defineRoute } from "@/lib/http";
import { apply } from "@/lib/recovery/service";
import { applyInputSchema } from "@/lib/validation";

export const POST = defineRoute({ name: "recovery.apply", mutating: true, schema: applyInputSchema }, (ctx, input) => apply(ctx, input));
