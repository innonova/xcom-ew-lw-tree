---
title: "Operation Slingshot and Operation Progeny: which missions are done, and
  when the next comes"
status: done
priority: 2
---

## Purpose

The person, 2026-10-29: "could we add information about operation progeny
and slingshot to the tool, which missions have been completed and when to
expect the missions?"

The two DLC operations are chains of three council missions each. The game
says nothing about the next one until it is on the map, and one missed
mission (failed, or left to expire) ends the chain for the campaign. A
player who knows a mission is due can keep a squad ready and the Skyranger
home for it.

## What the game does (read from its script, LW 1.0 and LWR 2.06)

The council object (`XGFundingCouncil`, in Long War campaigns its subclass
`XGFundingCouncil_Mod`, which changes only maps and names) keeps, in the save:
- whether each operation is on (`m_bSlingshotEnabled`, `m_bProgenyEnabled`,
  chosen when the campaign started);
- each one's next mission (`m_eNextSlingshotMission`, `m_eNextProgenyMission`);
  a won mission moves it on, a failed or expired one sets it to the end;
- `m_eLastSlingshotMission`, `m_iNextSlingshotDay` (days from the campaign's
  start, `XGStrategyAI.m_kStartDate`; −1 until the next daily check sets it),
  `m_bFuriesWon`;
- the hours until the month's next council mission (`m_iFirstRequestCountdown`);
  the council missions on the map (`XGMission_FundingCouncil`, with the time
  left in half hours, `m_iDuration`).

**Slingshot** (China; Low Friends, Confounding Light, Gangplank) has its own
clock: Low Friends on day 65 of the campaign (5 May), Confounding Light 25
days after Low Friends is won, Gangplank 2 days after Confounding Light.
The same in LW and LWR.

**Progeny** (France; Portent, Deluge, Furies) takes the place of an ordinary
council mission when one comes:
- LW: a council mission comes once a month, 14 to 28 days after the 1st.
  Portent is that mission from April on; Deluge and Furies once the Psi
  Labs are built and from October.
- LWR: council missions come 14 to 28 days after the 1st and then every 7
  to 14 days. Each one rolls: Portent from month 2 + 0–3 (May at the
  earliest, surely by August), or once past month 4 + 0–2; Deluge and
  Furies only past month 4 + 0–2 (August at the earliest, surely from
  October). No Psi Labs needed.

## What a player sees

With a campaign's save loaded, the campaign bar has **Operations** beside
Stats and Checks. It opens a panel with the two operations, each its three
missions in order, each mission one of:
- won;
- on the map now, with the hours left;
- next, with when: a date for Slingshot; for Progeny, the next council
  mission's date and whether it will be this one, or what it waits for
  (the Psi Labs, a month, LWR's odds);
- later;
- lost: the chain ended there (failed or left to expire). For Gangplank the
  save cannot tell won from lost (it gives no council reward): "played".

An operation switched off for the campaign says so. What the panel says is
the game's own rule, read from its script, with no guess beyond the dice
LWR rolls.

## Verification

- The reading, against the sample saves: LW in March (both operations not
  started; Low Friends due 5 May), in July (Gangplank on the map with 8
  hours left; Portent won, Deluge next), in August (Slingshot over; Deluge
  waiting for the Psi Labs); LWR at its start.
- The rules as unit tests on given states, both versions.
- The panel seen in the browser with a save loaded.

## Report (2026-10-29)

- **Read from the game's script** (LW 1.0's and LWR 2.06's
  `XComStrategyGame.upk`, decompiled locally with upkit; LW's
  `XGFundingCouncil_Mod` only changes maps and names). The rules above are
  the code's, with three details found on the way:
  - the month's council mission is drawn on the 1st (payday), 336 to 671
    hours ahead; LWR then draws the next one 168 to 335 hours after each;
  - Slingshot is checked every half hour (the AI update), and only while no
    aircraft is out;
  - a mission's time on the map is in half hours (`ABDUCTION_TIMER = 16`,
    "8 hours").
- **The save** (`src/save/campaign.ts`): `Campaign.council`, read from
  `XGFundingCouncil` or `XGFundingCouncil_Mod`: the flags, next and last
  missions, Slingshot's day, the countdown, the past council missions in
  order (which tells where a Progeny chain was lost), the council missions
  on the map, and the campaign's start date.
- **The rules** (`src/model/operations.ts`): per mission won / on the map /
  next / later / lost / played / not coming, with a sentence of when.
  LWR's rolls as a chance per council mission (`lwrChance`).
- **The panel**: **Operations** in the campaign bar, beside Stats and Checks.

**Verified**:
- 12 unit tests (`src/model/__tests__/operations.spec.ts`): the committed
  fixture saves (December, both operations over, Furies won and Gangplank
  "played"; March, Low Friends on 5 May and Portent in April; LWR at its
  start); the July and August sample saves where present (Gangplank on the
  map with 8 hours left; Deluge waiting for the Psi Labs, then for October);
  and the rules on given states, both versions. The site's suite: 271 tests,
  type check, lint.
- Seen in the browser with the July save and the LWR save loaded: the panel
  as described, under the campaign bar.

**Not verified**: a save made while Progeny or Slingshot is lost part way
(none among the samples); the panel on a phone-width screen.

**Open**: a mid-mission save shows the strategy state from the mission's
start, so a council mission being played reads "on the map". The save does
not say plainly which mission is under way; the panel does not guess.
