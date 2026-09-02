import { defineRoute } from "@/lib/http";
import { preview } from "@/lib/recovery/service";
import { previewInputSchema } from "@/lib/validation";

export const POST = defineRoute({ name: "recovery.preview", mutating: true, schema: previewInputSchema }, (ctx, input) =>
  preview(ctx, input),
);
