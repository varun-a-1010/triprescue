# 90-second demo script

Pre-flight: fresh session (clear the `triprescue_session` cookie or open a private window), `TRIPRESCUE_PROVIDER=duffel`, ChatGPT desktop app on a supported model with the built-in browser open on the deployed URL. Verify the address-bar tools arrow shows **5 tools** before recording.

1. **0–10 s — Problem and proof.** "TripRescue helps a traveller recover a disrupted itinerary. This is a real Duffel test-mode booking and a simulated airline schedule change." Point at the **Duffel Sandbox** badge and the `ord_…` test order id. Click **Create sandbox trip**, then **Simulate airline change**.
2. **10–20 s — WebMCP discovery.** Open the address-bar arrow: five site tools. "The normal buttons do exactly the same things."
3. **20–35 s — Read and constrain.** Ask: *"What happened to my trip? Find a direct replacement arriving by 6 PM for no more than £80 extra."* Watch the disruption banner and ranked options update as `get_trip` and `find_recovery_options` run; open the Agent activity log briefly.
4. **35–52 s — Preview.** Ask: *"Show me exactly what would change for the best option, but don't book it."* Show the before/after card, the exact total and the expiry.
5. **52–68 s — Human control.** Ask: *"Apply that change."* The site's confirmation dialog opens with the sandbox badge and exact price. Pause. Click **Confirm sandbox booking change**.
6. **68–82 s — Verification.** Ask: *"Did it go through?"* `get_change_status` refetches the Duffel order; the trip card now shows the new flight and "Verified".
7. **82–90 s — Why WebMCP.** "The agent never saw a button, a booking id, or our Duffel token. It used typed site tools, shared the page's session, and the traveller stayed in control. Without WebMCP, the same site still works."

Evidence to capture (screenshots): tool list in the address bar / DevTools; the confirmation dialog with price; the verified card with the changed itinerary and the test order id.
