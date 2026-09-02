import { defineRoute } from "@/lib/http";
import { seed } from "@/lib/recovery/service";
import { seedInputSchema } from "@/lib/validation";

export const POST = defineRoute({ name: "demo.seed", mutating: true, schema: seedInputSchema }, (ctx, input) => seed(ctx, input));
