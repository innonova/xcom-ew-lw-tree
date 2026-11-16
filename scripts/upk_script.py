#!/usr/bin/env python3
"""Read compiled UnrealScript (UE3, package version 845) back into rough
expressions, enough to see what a function decides. Used by upk_techtree.py.

    python3 scripts/upk_script.py samples/CookedPCConsole/XComStrategyGame.upk XGTechTree.HasPrereqs

Covers the tokens Enemy Within's strategy code uses for its rules; anything
else ends the listing with a '??' line. Jump targets are memory offsets (object
references take 8 bytes there, 4 in the file); the listing prints both the
file and the memory offset of each statement.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from upk import class_name, load  # noqa: E402

# UE3 Object.uc native operator numbers.
NATIVE = {
    0x81: '!', 0x82: '&&', 0x83: '^^', 0x84: '||', 0x85: '*=', 0x86: '/=', 0x87: '+=', 0x88: '-=',
    0x89: '++pre', 0x8a: '--pre', 0x8b: '++', 0x8c: '--', 0x8d: '~', 0x8f: '-pre',
    0x90: '*', 0x91: '/', 0x92: '+', 0x93: '-', 0x94: '<<', 0x95: '>>', 0x96: '<', 0x97: '>',
    0x98: '<=', 0x99: '>=', 0x9a: '==', 0x9b: '!=', 0x9c: '&', 0x9d: '^', 0x9e: '|',
    0x9f: '*=', 0xa0: '/=', 0xa1: '+=', 0xa2: '-=', 0xa3: '++pre', 0xa4: '--pre', 0xa5: '++', 0xa6: '--',
    0xa9: '-pre', 0xaa: '**', 0xab: '*', 0xac: '/', 0xad: '%', 0xae: '+', 0xaf: '-',
    0xb0: '<', 0xb1: '>', 0xb2: '<=', 0xb3: '>=', 0xb4: '==', 0xb5: '!=',
    0xb6: '*=', 0xb7: '/=', 0xb8: '+=', 0xb9: '-=', 0xba: 'abs',
    0xf2: '==', 0xf3: '!=', 0xf4: 'fmin', 0xf5: 'fmax', 0xf6: 'fclamp', 0xf9: 'min', 0xfa: 'max', 0xfb: 'clamp', 0xfd: '%',
}


class Script:
    def __init__(s, pk, code):
        s.pk = pk; s.b = code; s.o = 0; s.refs = 0

    def u8(s): v = s.b[s.o]; s.o += 1; return v
    def u16(s): v = struct.unpack_from('<H', s.b, s.o)[0]; s.o += 2; return v
    def i32(s): v = struct.unpack_from('<i', s.b, s.o)[0]; s.o += 4; return v
    def f32(s): v = struct.unpack_from('<f', s.b, s.o)[0]; s.o += 4; return v

    def obj(s):
        s.refs += 1  # 4 bytes in the file, 8 in memory, where jump targets point
        i = s.i32()
        return class_name(s.pk, i) if i else 'none'

    def name(s):
        i = s.i32(); s.i32(); return s.pk['names'][i]

    def params(s):
        out = []
        while s.b[s.o] != 0x16:
            out.append(s.expr())
        s.o += 1
        return out

    def expr(s):
        t = s.u8()
        if t == 0x00: return s.obj()
        if t == 0x01: return 'self.' + s.obj()
        if t == 0x02: return 'default.' + s.obj()
        if t == 0x04: return 'return ' + s.expr()
        if t == 0x05: s.obj(); s.u8(); return 'switch(' + s.expr() + ')'
        if t == 0x06: return f'goto {s.u16()}'
        if t == 0x07: off = s.u16(); return f'if !({s.expr()}) goto {off}'
        if t == 0x0a: return 'default:' if s.u16() == 0xffff else f'case {s.expr()}:'
        if t == 0x0b: return 'nothing'
        if t == 0x0e: s.obj(); return s.expr()
        if t in (0x0f, 0x14): a = s.expr(); b = s.expr(); return f'{a} = {b}'
        if t in (0x10, 0x1a): i = s.expr(); a = s.expr(); return f'{a}[{i}]'
        if t == 0x11:  # new(outer, name, flags) class
            parts = [s.expr() for _ in range(4)]; return f'new({", ".join(parts)})'
        if t == 0x12: c = s.expr(); s.u16(); s.obj(); s.u8(); return f'{c}::{s.expr()}'
        if t == 0x13: c = s.obj(); return f'class<{c}>({s.expr()})'
        if t == 0x15: return ''
        if t == 0x17: return 'self'
        if t == 0x18: s.u16(); return s.expr()
        if t == 0x19: c = s.expr(); s.u16(); s.obj(); s.u8(); return f'{c}.{s.expr()}'
        if t == 0x1b: n = s.name(); return f'{n}({", ".join(s.params())})'
        if t == 0x1c: n = s.obj(); return f'{n}({", ".join(s.params())})'
        if t == 0x1d: return str(s.i32())
        if t == 0x1e: return repr(round(s.f32(), 4))
        if t == 0x1f:
            e = s.b.index(0, s.o); v = s.b[s.o:e].decode('latin-1'); s.o = e + 1; return repr(v)
        if t == 0x20: return s.obj()
        if t == 0x21: return "'" + s.name() + "'"
        if t == 0x24: return f'b{s.u8()}'
        if t == 0x25: return '0'
        if t == 0x26: return '1'
        if t == 0x27: return 'true'
        if t == 0x28: return 'false'
        if t == 0x2a: return 'none'
        if t == 0x2c: return str(s.u8())
        if t == 0x2d: return s.expr()
        if t == 0x2e: c = s.obj(); return f'{c}({s.expr()})'
        if t == 0x35: f = s.obj(); s.obj(); s.u8(); s.u8(); return f'{s.expr()}.{f}'
        if t == 0x36: return f'{s.expr()}.Length'
        if t == 0x37: n = s.name(); return f'global.{n}({", ".join(s.params())})'
        if t == 0x38: s.u8(); return s.expr()
        if t == 0x3a: s.obj(); return 'return'
        if t == 0x45: c = s.expr(); s.u16(); a = s.expr(); s.u16(); b = s.expr(); return f'({c} ? {a} : {b})'
        if t == 0x40: a = s.expr(); i = s.expr(); n = s.expr(); s.u8(); return f'{a}.Remove({i}, {n})'
        if t == 0x46: a = s.expr(); s.u16(); v = s.expr(); s.u8(); return f'{a}.Find({v})'
        if t == 0x47: a = s.expr(); s.u16(); f = s.expr(); v = s.expr(); s.u8(); return f'{a}.Find({f}, {v})'
        if t == 0x48: return 'out ' + s.obj()
        if t == 0x49: s.u16(); e = s.expr(); s.u8(); return f'default {e}'
        if t == 0x4a: return ''
        if t == 0x53: return 'END'
        if t == 0x54: a = s.expr(); n = s.expr(); s.u8(); return f'{a}.Add({n})'
        if t == 0x55: a = s.expr(); s.u16(); v = s.expr(); s.u8(); return f'{a}.AddItem({v})'
        if t == 0x56: a = s.expr(); s.u16(); v = s.expr(); s.u8(); return f'{a}.RemoveItem({v})'
        if t == 0x57: a = s.expr(); s.u16(); i = s.expr(); v = s.expr(); s.u8(); return f'{a}.InsertItem({i}, {v})'
        if t == 0x58:
            # array, item, has-index byte, the index (an empty marker when unused), end offset
            a = s.expr(); v = s.expr(); has = s.u8(); i = s.expr(); s.u16()
            return f'foreach {a}({v}{", " + i if has else ""})'
        if t == 0x2f: e = s.expr(); end = s.u16(); return f'foreach {e} (ends {end})'
        if t == 0x30: return 'iterator pop'
        if t == 0x31: return 'iterator next'
        if 0x60 <= t <= 0x6f:
            idx = ((t - 0x60) << 8) + s.u8(); return f'native{idx}({", ".join(s.params())})'
        if t >= 0x70:
            op = NATIVE.get(t, f'op{t:#x}'); ps = s.params()
            if len(ps) == 2: return f'({ps[0]} {op} {ps[1]})'
            if len(ps) == 1: return f'{op}({ps[0]})'
            return f'{op}({", ".join(ps)})'
        raise ValueError(f'token {t:#x} at {s.o - 1}')

    def statements(s, mem=False):
        """[(file offset, text)], ending at the function's END or at a token not
        covered; with mem, [(file offset, memory offset, text)]."""
        out = []
        while s.o < len(s.b):
            at = s.o
            m = at + 4 * s.refs
            try:
                e = s.expr()
            except Exception as ex:  # an uncovered token: stop here, say where
                out.append((at, m, f'?? {ex}') if mem else (at, f'?? {ex}')); break
            out.append((at, m, e) if mem else (at, e))
            if e == 'END': break
        return out


def function_code(pk, full):
    """Bytecode of 'Class.Function'. A UFunction export holds its script at byte
    48, after NetIndex, the property terminator, UField/UStruct links and the
    script's memory and storage sizes (the storage size is at byte 44)."""
    ex = pk['exports']

    def path(i):
        e = ex[i]; n = e['name']
        while e['outer'] > 0:
            e = ex[e['outer'] - 1]; n = e['name'] + '.' + n
        return n
    for i, e in enumerate(ex):
        if class_name(pk, e['cls']) == 'Function' and path(i) == full:
            b = pk['b'][e['off']:e['off'] + e['size']]
            return b[48:48 + struct.unpack_from('<i', b, 44)[0]]
    raise KeyError(full)


def statements(pk, full, mem=False):
    return Script(pk, function_code(pk, full)).statements(mem)


if __name__ == '__main__':
    _, pk = load(sys.argv[1])
    for at, m, s in statements(pk, sys.argv[2], mem=True):
        print(f'{at:5} {m:5}: {s}')
