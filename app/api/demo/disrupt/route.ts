import { defineRoute } from "@/lib/http";
import { disrupt } from "@/lib/recovery/service";
import { emptyInputSchema } from "@/lib/validation";

export const POST = defineRoute({ name: "demo.disrupt", mutating: true, schema: emptyInputSchema }, (ctx) => disrupt(ctx));
