#!/usr/bin/env python3
"""Extract Long War's council requests from its XComStrategyGame.upk into data/requests.json.

    python3 scripts/upk_requests.py <Long War's XComGame folder> > data/requests.json

Run on stock Long War 1.0 (its {app}/XComGame). Only numbers are written (no words).
From XGFundingCouncil.BuildRequest (scripts/upk_script.py): per EFCRequest, the item asked for (EItemType), the techs it
needs (ETechType), how many (a number; "corpses" or "fragments" for GetNumberOfCorpsesToSell, GetNumberOfFragmentsToSell;
{"rand": [n, add]} for Rand(n) + add), its hours (FCREQUEST_DAYS x a factor, or a number of hours), whether it is a
transfer (a satellite over the country, a jet to its continent), the item shown, and its rewards: one list per branch of
the Rand(n) switch Long War rolls (each followed through its jumps, as the hand-patched bytecode has them), each reward
{"type": EFCRewardType, "min": n, "max": n} for CreateReward (its defaults 2 and 2), or {"type", "amount"} added directly.
The constants are DefaultGameData.ini's [XComStrategyGame.XGFundingCouncil].

Anything the script does not recognise stops it.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import load  # noqa: E402
from upk_script import statements  # noqa: E402

END = 'goto 9212'


def num(s):
    s = s.strip()
    m = re.fullmatch(r'b?(-?\d+)', s)
    if not m:
        raise ValueError(s)
    return int(m.group(1))


def reward_call(s):
    """CreateReward(kRequest, type, min, max) -> {type, min, max} (defaults 2, 2)."""
    m = re.fullmatch(r'CreateReward\(kRequest, (b?\d+), ?([^,]*), ?([^,)]*)\)', s)
    if not m:
        return None
    lo = num(m.group(2)) if m.group(2).strip() else 2
    hi = num(m.group(3)) if m.group(3).strip() else 2
    return {'type': num(m.group(1)), 'min': lo, 'max': hi}


def main():
    root = sys.argv[1]
    _, pk = load(os.path.join(root, 'CookedPCConsole', 'XComStrategyGame.upk'))
    data = open(os.path.join(root, 'Config', 'DefaultGameData.ini'), encoding='latin1').read()
    section = data[data.index('[XComStrategyGame.XGFundingCouncil]'):]
    section = section[:section.index('\n[', 1)]
    ini = {m.group(1): float(m.group(2)) for m in re.finditer(r'^(\w+)\s*=\s*([-\d.]+)f?', section, re.M)}

    # (Jump targets are memory offsets: each statement's own, beside its file offset.)
    st = [(m, t) for _, m, t in statements(pk, 'XGFundingCouncil.BuildRequest', mem=True)]
    at = {o: i for i, (o, _) in enumerate(st)}
    # The outer switch's cases: where each begins.
    starts = [(i, num(re.fullmatch(r'case (b?\d+):', s).group(1))) for i, (_, s) in enumerate(st)
              if re.fullmatch(r'case b\d+:', s)]

    def run(i, branch):
        """Statements from i on, as Long War runs them with Rand(..) = branch (None: no switch met yet)."""
        out = []
        n = None
        guard = 0
        while i < len(st):
            guard += 1
            if guard > 500:
                sys.exit('BuildRequest: a loop')
            o, s = st[i]
            if s == END or (re.fullmatch(r'case b\d+:', s) and out):
                return out, n
            if s in ('nothing', 'kRequest', 'break') or s.startswith('return'):
                i += 1
                continue
            if m := re.fullmatch(r'goto (\d+)', s):
                i = at[int(m.group(1))]
                continue
            if m := re.fullmatch(r'switch\(op0xa7\((\d+)\)\)', s):
                n = int(m.group(1))
                # Dispatch: the case equal to the branch, else default.
                j = i + 1
                target = None
                default = None
                while j < len(st) and st[j][1] != END:
                    cm = re.fullmatch(r'case (\d+):', st[j][1])
                    if cm and int(cm.group(1)) == branch and target is None:
                        target = j
                    if st[j][1] == 'default:' and default is None:
                        default = j
                    if re.fullmatch(r'case b\d+:', st[j][1]):
                        break
                    j += 1
                i = (target if target is not None else default) + 1
                continue
            if re.fullmatch(r'case \d+:', s) or s == 'default:':
                # Reached by falling through (a hand patch's jump lands past a label): no test in the way.
                i += 1
                continue
            out.append(s)
            i += 1
        return out, n

    requests = []
    for k, (i, rid) in enumerate(starts):
        _, n = run(i, 0)
        branches = [run(i, b)[0] for b in range(n or 1)]
        req = {'id': rid}
        alts = []
        for b, body in enumerate(branches):
            rewards = []
            pending = []
            for s in body:
                if m := re.fullmatch(r'kRequest\.eRequestedItem = (b?\d+)', s):
                    req['item'] = num(m.group(1))
                elif m := re.fullmatch(r'kRequest\.eDisplayItem = (b?\d+)', s):
                    req['display'] = num(m.group(1))
                elif m := re.fullmatch(r'kRequest\.arrRequirements\.AddItem\((b?\d+)\)', s):
                    if b == 0:
                        req.setdefault('requires', []).append(num(m.group(1)))
                elif m := re.fullmatch(r'(?:kRequest\.iRequestedAmount|iRequestedAmount) = (.*)', s):
                    a = m.group(1)
                    if a == 'GetNumberOfCorpsesToSell()':
                        req['amount'] = 'corpses'
                    elif a == 'GetNumberOfFragmentsToSell()':
                        req['amount'] = 'fragments'
                    elif a == 'iRequestedAmount':
                        pass
                    elif rm := re.fullmatch(r'\(op0xa7\((\d+)\) \+ (\d+)\)', a):
                        req['amount'] = {'rand': [int(rm.group(1)), int(rm.group(2))]}
                    else:
                        req['amount'] = num(a)
                elif s == 'kRequest.bIsTransferRequest = true':
                    req['transfer'] = True
                elif m := re.fullmatch(r'kRequest\.arrRewards\.AddItem\((b?\d+)\)', s):
                    pending.append(num(m.group(1)))
                elif m := re.fullmatch(r'kRequest\.arrRewardAmounts\.AddItem\((-?\d+)\)', s):
                    rewards.append({'type': pending.pop(0), 'amount': int(m.group(1))})
                elif (r := reward_call(s)) is not None:
                    rewards.append(r)
                elif m := re.fullmatch(r'kRequest\.iHours = \(self\.FCREQUEST_DAYS \* (\d+)\)', s):
                    req['hoursFactor'] = int(m.group(1))
                elif m := re.fullmatch(r'kRequest\.iHours = (\d+)', s):
                    req['hours'] = int(m.group(1))
                elif re.fullmatch(r'if !\(!\(CanTransfer(Satellite|Jet)\(kRequest\.ECountry\)\)\) goto \d+', s):
                    req['transfer'] = 'satellite' if 'Satellite' in s else 'jet'
                elif s.startswith('out isValidRequest') or re.fullmatch(r'case b\d+:', s):
                    pass
                else:
                    sys.exit(f'BuildRequest {rid}: unrecognised {s!r}')
            alts.append(rewards)
        req['rewards'] = alts
        requests.append(req)

    json.dump({
        'source': "Long War 1.0's XGFundingCouncil.BuildRequest (XComStrategyGame.upk) and its DefaultGameData.ini; "
                  'read by scripts/upk_requests.py',
        'constants': {k: ini[k] for k in ('FCREQUEST_DAYS', 'PROFIT_MARGIN', 'BASE_REQUEST_COOLDOWN_DAYS',
                      'FC_REQUEST_EXTENDED_COOLDOWN_DAYS', 'REQUEST_MISSION_CHANCE') if k in ini},
        'requests': requests,
    }, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
