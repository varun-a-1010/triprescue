import { defineRoute } from "@/lib/http";
import { getTrip } from "@/lib/recovery/service";

export const GET = defineRoute({ name: "trip.get", mutating: false }, (ctx) => getTrip(ctx));
