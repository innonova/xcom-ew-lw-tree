#!/usr/bin/env python3
"""Extract what each item and base facility needs before engineering can build
it from Long War's XComStrategyGame.upk into data/itemtree.json.

    python3 scripts/upk_itemtree.py samples > data/itemtree.json

`samples` holds the player's CookedPCConsole/, which stays out of the
repository; only the numbers read from it are committed (no names). The rules
come from XGItemTree's compiled script (scripts/upk_script.py):

- BuildItems: BuildItem(iItem, iCategory, , , , , , eTechReq, eItemReq,
  eFoundryReq, iImage) per item. The costs, build time and engineers are left
  out there and come from ItemBalance_Normal in DefaultGameCore.ini
  (BalanceItems), so they are not in this file.
- CanBeBuilt (XGItemTree.CanBuildItem): the tech researched, the Foundry
  project done; the item requirement is a cost, one consumed per item built
  (XGFacility_Engineering.GetItemProjectCost).
- BuildFacilities: BuildFacility(iFacility, iCash, iElerium, iAlloy,
  iMaintenance, iEngineers, iTime, iPower, iSize, eTechReq, eItemReq, iImage)
  per base facility: its size (tiles) and the tech it needs (CanFacilityBeBuilt);
  the costs, upkeep, days and power are FacilityBalance in DefaultGameCore.ini
  (BalanceFacilities).

Anything the script does not recognise stops it, so a changed rule is noticed
rather than dropped.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import enum_values, enums, load  # noqa: E402
from upk_script import statements  # noqa: E402


def num(x):
    return int(x.lstrip('b')) if x else 0


def main():
    cooked = os.path.join(sys.argv[1], 'CookedPCConsole')
    _, game = load(os.path.join(cooked, 'XComGame.upk'))
    _, pk = load(os.path.join(cooked, 'XComStrategyGame.upk'))
    found = enums(game)
    item_enum = enum_values(game, found['EItemType'])
    tech_enum = enum_values(game, found['ETechType'])

    items = []
    for _, s in statements(pk, 'XGItemTree.BuildItems'):
        if s in ('BalanceItems()', 'return', 'return nothing', 'nothing', 'END', ''):
            continue
        m = re.fullmatch(r'BuildItem\((.*)\)', s)
        if not m:
            sys.exit(f'BuildItems: unrecognised statement {s!r}')
        a = [x.strip() for x in m.group(1).split(',')] + [''] * 11
        if any(a[2:7]):
            sys.exit(f'BuildItems: costs in the code, not the INI: {s!r}')
        iid = num(a[0])
        e = {'id': iid, 'enum': item_enum[iid], 'category': num(a[1])}
        if num(a[7]):
            e['tech'] = {'id': num(a[7]), 'enum': tech_enum[num(a[7])]}
        if num(a[8]):
            e['item'] = {'id': num(a[8]), 'enum': item_enum[num(a[8])]}
        if num(a[9]):
            e['foundry'] = num(a[9])
        items.append(e)

    facility_enum = enum_values(game, found['EFacilityType'])
    facilities = []
    for _, s in statements(pk, 'XGItemTree.BuildFacilities'):
        if s in ('BalanceFacilities()', 'return', 'return nothing', 'nothing', 'END', ''):
            continue
        m = re.fullmatch(r'BuildFacility\((.*)\)', s)
        if not m:
            sys.exit(f'BuildFacilities: unrecognised statement {s!r}')
        a = [x.strip() for x in m.group(1).split(',')] + [''] * 12
        fid = num(a[0])
        e = {'id': fid, 'enum': facility_enum[fid], 'size': num(a[8])}
        if num(a[9]):
            e['tech'] = {'id': num(a[9]), 'enum': tech_enum[num(a[9])]}
        if num(a[10]):
            e['item'] = {'id': num(a[10]), 'enum': item_enum[num(a[10])]}
        facilities.append(e)

    json.dump({
        'source': 'Long War 1.0 XComStrategyGame.upk (XGItemTree.BuildItems, BuildFacilities); costs, time, '
                  'engineers, upkeep and power are ItemBalance_Normal and FacilityBalance in DefaultGameCore.ini; '
                  'read by scripts/upk_itemtree.py',
        'items': items,
        'facilities': facilities,
    }, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
