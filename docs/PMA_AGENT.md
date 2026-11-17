# Property Management Assistant agent ("Ava")

Updated 2026-11-17. Keep this file in step with the live agent (rule: every agent change updates its doc).

| Item | Value |
|---|---|
| ElevenLabs agent | "Property Management Assistant", `agent_4901m5gzk15hfajrapnvb520f9jt` |
| Live version | `agtvrsn_4901m7kv7kdxe88bxe43hmh693rx` (main branch `agtbrch_5201m5gzk2e1f69tpygbp2gaxkz9`) |
| Caller hears | "Desert Ridge Customer Care Center", "Ava" (fictitious property company) |
| Phone | (725) 201-0584 (language menu first); main line (702) 710-8456 option 2 |
| LLM | gemini-3.5-flash |
| Tools | `create_incident`, `record_contact_preference`, `get_case_status`, `close_session` (all on this site's `netlify/functions/cedar-elevenlabs.js`, authenticated with ElevenLabs secret `pma_tool_key`), `end_call`, `language_detection` |

## Behaviour notes (2026-11-17 audit fixes)
- Output rule: at most one voice tag ([serious] or [slow]) at the start of a reply, none in the closing line (fixed runaway "[happy] [slow]..." tags at goodbye).
- The closing line drops the caller's name when it is unknown (fixed "Thank you for calling Desert Ridge Customer Care, ." ).
- Case numbers: read `caseNumberSpoken` from the most recent `get_case_status` result only (fixed the wrong case read after a MULTIPLE_CASES list). After MULTIPLE_CASES, ask which request and call `get_case_status` again for it.
- Caller ID: own Stellar lines are never treated as the caller's number (`ownLineToCaller`).
- Follow-up texts send from the PMA line through `lib/pma-sms` (static require; the dynamic require caused MODULE_NOT_FOUND in production).
- `close_session` uses the single 5-argument RPC (`pma_voice_session_close_v1`); the ambiguous 6-argument overload was dropped.

## Tests (all pass 2026-11-17)
Attached: "Customer Care — Existing Case Status Lookup Test" `test_1501m64sq9mjfsf94mknk4vkwhap`, "Maintenance Caller — Full Intake & Case Creation Test" `test_5301m64srjr1f4kbrkgtx5429jne`. End-to-end (real tools): PMA-01 `test_5101m7kqk01de7mbys0w57fhexk4`, PMA-02 `test_8501m7kqk0jkfh8azrkrwt41zgsn`. Run PMA-02 only after PMA-01 finishes: it looks up the faucet case PMA-01 creates.

The full live prompt is in ElevenLabs. Read it there before editing; editor saves can overwrite API changes.
