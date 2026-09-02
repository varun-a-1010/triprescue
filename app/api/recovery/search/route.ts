import { defineRoute } from "@/lib/http";
import { search } from "@/lib/recovery/service";
import { recoveryPreferencesSchema } from "@/lib/validation";

export const POST = defineRoute({ name: "recovery.search", mutating: true, schema: recoveryPreferencesSchema }, (ctx, prefs) =>
  search(ctx, prefs),
);
