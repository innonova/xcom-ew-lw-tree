#!/usr/bin/env python3
"""Extract Long War's council missions from its XComStrategyGame.upk into data/council.json.

    python3 scripts/upk_council.py <Long War's XComGame folder> > data/council.json

Run on stock Long War 1.0 (its {app}/XComGame). Only numbers and EW's map names are written (no words).
From XGFundingCouncil.BuildMission (scripts/upk_script.py): per EFCMission, its kind (eType: 1 assault,
2 bomb, 3 extraction, 4 rescue, 5 special), its rewards (EFCRewardType: 1 cash, 3 a soldier, 4 engineers,
5 scientists, 6 the country's panic, 8 an item 161 ...), each with its amount, the panic on failure, and its
map and mission variant. A cash amount Long War rolls is written as {"money": factor}, factor the
multiplier of RandMoneyRewardAmount(MIN_MONEY_REWARD, MAX_MONEY_REWARD, 5) (FCM_MONEY_SCALAR read from
DefaultGameData.ini); a soldier Long War makes as {"soldier": [class, level]} (-1: rolled), or "named"
for one of its own. The DLC chains (Slingshot) are left out.

Anything the script does not recognise stops it.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402


def main():
    root = sys.argv[1]
    cooked = os.path.join(root, 'CookedPCConsole')
    _, game = load(os.path.join(cooked, 'XComGame.upk'))
    _, pk = load(os.path.join(cooked, 'XComStrategyGame.upk'))
    fcm = enum_values(game, enums(game)['EFCMission'])
    data = open(os.path.join(root, 'Config', 'DefaultGameData.ini'), encoding='latin1').read()
    section = data[data.index('[XComStrategyGame.XGFundingCouncil]'):]
    section = section[:section.index('\n[', 1)]
    ini = {m.group(1): m.group(2) for m in re.finditer(r'^(\w+)\s*=\s*([-\d.]+)f?', section, re.M)}

    missions = []
    cur = None
    pending_reward = []
    for _, s in statements(pk, 'XGFundingCouncil.BuildMission'):
        if m := re.fullmatch(r'case b?(\d+):', s):
            cur = {'id': int(m.group(1)), 'enum': fcm[int(m.group(1))], 'rewards': []}
            missions.append(cur)
            pending_reward = []
            continue
        if cur is None:
            continue
        if m := re.fullmatch(r'kMission\.eType = b?(\d+)', s):
            cur['kind'] = int(m.group(1))
        elif m := re.fullmatch(r'kMission\.ECountry = b?(\d+)', s):
            cur['country'] = int(m.group(1))
        elif m := re.fullmatch(r'kMission\.arrRewards\.AddItem\(b?(\d+)\)', s):
            pending_reward.append(int(m.group(1)))
        elif s.startswith('kMission.arrRewardAmounts.AddItem('):
            a = s[len('kMission.arrRewardAmounts.AddItem('):-1]
            kind = pending_reward.pop(0)
            if re.fullmatch(r'-?\d+', a):
                amount = int(a)
            elif m := re.fullmatch(r'\((-?\d+) \* (\d+)\)', a):
                amount = int(m.group(1)) * int(m.group(2))
            elif a == 'RandMoneyRewardAmount(self.MIN_MONEY_REWARD, self.MAX_MONEY_REWARD, 5)':
                amount = {'money': 1}
            elif a == '(RandMoneyRewardAmount(self.MIN_MONEY_REWARD, self.MAX_MONEY_REWARD, 5) * self.FCM_MONEY_SCALAR)':
                amount = {'money': float(ini['FCM_MONEY_SCALAR'])}
            elif a == '(RandMoneyRewardAmount(self.MIN_MONEY_REWARD, self.MAX_MONEY_REWARD, 5) / 1)':
                amount = {'money': 1}
            elif a == '(2 * RandMoneyRewardAmount(self.MIN_MONEY_REWARD, self.MAX_MONEY_REWARD, 5))':
                amount = {'money': 2}
            elif m := re.fullmatch(r'RewardSoldier\((-?\d+), (-?\d+)\)', a):
                amount = {'soldier': [int(m.group(1)), int(m.group(2))]}
            else:
                sys.exit(f'BuildMission: unrecognised reward amount {a!r}')
            cur['rewards'].append({'type': kind, 'amount': amount})
        elif s == 'kMission.arrRewardSoldiers.AddItem(CustomSoldier)':
            cur['rewards'].append({'type': 3, 'amount': 'named'})
        elif m := re.fullmatch(r'kMission\.iPanicOnFailure = self\.(\w+)', s):
            cur['panicOnFailure'] = int(ini[m.group(1)])
        elif m := re.fullmatch(r"kMission\.strMapName = '([^' ]+)(?: \(([^)]*)\))?'", s):
            cur['map'] = m.group(1)
            if m.group(2):
                cur['variant'] = m.group(2)
        elif m := re.fullmatch(r'kMission\.iFirstAct = (\d+)', s):
            cur['firstAct'] = int(m.group(1))

    keep = [m for m in missions if 'map' in m and not m['map'].startswith('DLC1_')]
    json.dump({
        'source': "Long War 1.0's XGFundingCouncil.BuildMission (XComStrategyGame.upk) and its DefaultGameData.ini; "
                  'read by scripts/upk_council.py',
        'constants': {k: float(ini[k]) for k in ('MIN_MONEY_REWARD', 'MAX_MONEY_REWARD', 'MAX_MONEY_REWARD_HARD',
                      'MAX_MONEY_REWARD_CLASSIC', 'MIN_MONEY_REWARD_EASY', 'FCM_MONEY_SCALAR', 'MISSION_FAIL_LOW_PANIC',
                      'MISSION_FAIL_HIGH_PANIC', 'MISSION_REWARD_LOW_DAYS', 'MISSION_REWARD_LOW_MULT', 'MISSION_REWARD_MED_DAYS',
                      'MISSION_REWARD_MED_MULT', 'MISSION_REWARD_SOLDIER_LOW_LEVEL', 'MISSION_REWARD_SOLDIER_MED_LEVEL',
                      'MISSION_REWARD_SOLDIER_HIGH_LEVEL', 'REQUEST_MISSION_CHANCE') if k in ini},
        'missions': keep,
    }, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
