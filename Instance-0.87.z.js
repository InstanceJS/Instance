/* Instance — single-file CLASSIC-script browser bundle.
 *   Chimera V17 kernel + Compiler v7.1.1 + v8 DSL + BIOS6 core.
 *   Built 2026-07-06T03:39:10.255Z.
 * Load with a PLAIN script tag (no type="module"):  <script src="instance.bundle.js"></script>
 * Construction is async, so wait on the readiness promise:
 *     InstanceReady.then(function (Instance) { ... new Div('hi') ... });
 * It self-boots the element-class globals (Div, Span, …) when a document is present,
 * and sets globalThis.Instance and globalThis.InstanceReady.
 */
(function () {
'use strict';
const CHIMERA_API = (function(factory) {

	const GLOBAL = ((_ = 'undefined') => typeof globalThis !== _ ? globalThis 
	: typeof window !== _ ? window 
	: typeof self !== _ ? self 
	: typeof global !== _ ? global 
	: this ?? new Function('return this')()
	)();
	const VERSION = '17.0.f';
	
	// AMD
    if (typeof define === 'function' && define.amd) {
        define([], function () { return factory(GLOBAL, {}, VERSION); });
    }
    // CommonJS
    else if (typeof module === 'object' && typeof module.exports === 'object') {
       return (module.exports = factory(GLOBAL, {}, VERSION));
    }
    // Browser global
    else {
        var api = factory(GLOBAL, {}, VERSION);
        GLOBAL.Chimera = api;
        // Also store under Symbol.for('Chimera') if needed
        /* Symbol.for('Chimera') already installed (read-only) by the factory */
		return api;
    }
})(function(global, deps, version) {

	// Tony Stark built this in a CAVE!!! With a box of SCRAPS!!
	// — If you're reading this, you're worthy.

/*
Considered Fork (unknown if sigil count is overkill):

	this.$(() => {}); // atomic (0), return value (when any) not proxied (atomic reference only)
	this.$$(() => {}); // shallow (-1), return value (when any) shallow proxied (reference, + shallow mutation)
	this.$$$(() => {}); // deep (+1), return value (when any) deep proxied (reference + shallow mutation + deep mutation)

*/

/*
═══════════════════════════════════════════════════════════════════════════════
   REFACTOR WARNING — INVARIANTS THAT MUST NOT BE BROKEN (V17.0.6)
═══════════════════════════════════════════════════════════════════════════════

This kernel is hand‑tuned for performance and correctness. The following
invariants are load‑bearing; changing any of them *without* fully understanding
the knock‑on effects will almost certainly introduce silent memory corruption,
use‑after‑free, or scheduling bugs.

───────────────────────────────────────────────────────────────────────────────
1. TRIT WORD ENCODING
───────────────────────────────────────────────────────────────────────────────
   Ψ = 81R + 27E + 9A + 3C + 1T   (signed Int8, range –121..+121)
   • R (Lifecycle): +1 Fresh, 0 Void/Frozen, –1 Stale
   • E (Eval topology): +1 Push, 0 Detached, –1 Pull
   • A (Gating): +1 Union(OR), 0 Phantom, –1 Consensus(AND)
   • C (Capture depth): +1 Deep, 0 Atomic, –1 Shallow
   • T (Tracking): +1 Volatile, 0 Untracked, –1 Semantic

   The absolute word `0` means **disposed** (graveyard). Any function that
   reads `_trits[ptr]` must treat `=== 0` as “dead slot” before interpreting
   other axes.

───────────────────────────────────────────────────────────────────────────────
2. NODE LIFE‑CYCLE & ALLOCATION
───────────────────────────────────────────────────────────────────────────────
   • allocNode() returns an index `ptr`. The slot’s previous state MUST be
     completely cleaned (wiring, tree, counters) before re‑use.
   • `_nodeGen[ptr]` is a **BigUint64** generation tag. Every (re‑)allocation
     bumps `_globalUUID` (also BigInt). This is the ABA defense.
   • freeNode() writes `_trits[ptr] = 0` and pushes the slot onto the free‑list
     whose head is `_freeNodeHead` and whose link is parked in `_headDep[ptr]`.
   • DO NOT call freeNode() on a slot that was never allocated, or on a slot
     already disposed, unless the function guards against double‑free.
   • The engine root (`_rootPtr`) must never be freed by user code.

───────────────────────────────────────────────────────────────────────────────
3. EDGE ALLOCATION & SUBSCRIBE
───────────────────────────────────────────────────────────────────────────────
   • subscribe(consumer, source) allocates **two** edge records atomically:
     first both, then wire them. If the second allocation OOMs, the first
     edge MUST be freed (rollback) to avoid a dangling subscriber edge.
   • An edge record has 4 lanes; EDGE_PAIR links the two halves of a
     subscription. Never modify EDGE_PAIR after wiring—it is the only way
     to unlink the counterpart.
   • `_edgeEpoch` (per‑edge BigUint64) is used for glitch dedup. Bump
     `_traceEpoch` before any new propagation ride that should see fresh
     subscriptions.
   • unsubscribe() must unlink BOTH the dependency edge (singly‑linked)
     and the subscriber edge (doubly‑linked) before freeing the lanes.
     Never free an edge that is still referenced in any list.

───────────────────────────────────────────────────────────────────────────────
4. TRACKING & ACTIVE READER
───────────────────────────────────────────────────────────────────────────────
   • `_activePtr` is the node currently executing. Its reads subscribe to the
     signals they touch.
   • Inside a reactive computation, the only way to form a dependency edge
     is through `track()`. `rawget()` does NOT track.
   • The T axis (Threshold) gates tracking: if `T=0` (Untracked), `track()`
     is a no‑op, even if `_activePtr` is set.
   • `_activePtr` must be saved/restored when entering/exiting a user function
     (e.g., in `runNode`, `recompute`, `next`, `memo`).
   • Do not call `track()` from outside a running node (except via manual
     subscribe API, which must be done with `_activePtr` managed carefully).

───────────────────────────────────────────────────────────────────────────────
5. OWNERSHIP TREE (parent/child/sibling)
───────────────────────────────────────────────────────────────────────────────
   • `adopt(parent, child)` inserts `child` as the first child of `parent`.
   • `unlinkSibling(child)` detaches the child from its current parent’s list.
   • The tree is used for **lifecycle nesting**: disposing a parent
     disposes all children recursively. A child whose parent is disposed
     MUST also be disposed.
   • NEVER create a cycle in the ownership tree. The kernel does not check
     for cycles; they will cause infinite recursion in disposal and crash.

───────────────────────────────────────────────────────────────────────────────
6. QUEUES & SCHEDULING (pending, zombie, worklist)
───────────────────────────────────────────────────────────────────────────────
   • The pending queue is a plain JavaScript array, but access MUST use
     `_pendingHead` and `_pendingTail` indices. **Never use .push()** to add
     a runnable node—always write `_pendingQueue[_pendingTail++] = ptr`.
     `.push()` bypasses the tail cursor and will cause nodes to be lost.
   • `flushQueue()` drains `_pendingHead` → `_pendingTail` and then RESETS
     both cursors to 0 **and** truncates the array (`.length = 0`) to release
     references.
   • The zombie queue (`_zombieQueue`) uses `.push()` / `.pop()` because it
     is only drained by `sweep()` and never read randomly. It is idempotent
     (nodes are already marked `_trits=0`), so ordering doesn’t matter.
   • `sweep()` must be called only after at least one node has been added to
     the zombie queue, and it must empty the queue completely each time.

───────────────────────────────────────────────────────────────────────────────
7. REAPER (sweep) & DEFERRAL
───────────────────────────────────────────────────────────────────────────────
   • `sweep()` performs two‑phase disposal:
     Phase 1: physically remove all edges and tree links for each dying node,
              decrement barrier counters of surviving consumers, and collect
              **Pull consumers** into a `frontier` array (deferred dirtying).
     Phase 2: dirty all deferred Pull consumers (Stale‑them).
   • The deferral prevents a diamond‑shaped graph from being dirtied while
     its last dep is being removed (which would trigger a recompute with a
     missing dep).
   • Do NOT reorder or combine the two phases, or you risk “use after free”
     (node that was just freed being re‑read by a still‑live consumer).
   • `cleanupDeps(ptr, reap)` with `reap=1` will also attempt to cascade‑reap
     owned leaf signals that no longer have external readers. This is safe
     but relies on `hasExternalReader()` being correct.

───────────────────────────────────────────────────────────────────────────────
8. CELL I/O: `_values` vs `_ctx`
───────────────────────────────────────────────────────────────────────────────
   • For **State** nodes: `_values[ptr]` holds the current value; `_ctx[ptr]`
     is unused (null).
   • For **Computed** nodes: `_values[ptr]` holds the computation FUNCTION;
     `_ctx[ptr]` holds the most recently cached result. `recompute()` checks
     `typeof _values[ptr] === 'function'` to decide whether to re‑execute.
   • For **Effect** nodes: similar to Computed, but scheduled eagerly.
   • **Never store a function inside `_ctx`** unless it’s the `.next()`
     iterator wrapper with `_chimeraFn`.
   • `get(ptr)` returns `typeof _values[ptr] === 'function' ? _ctx[ptr] : _values[ptr]`.
     This rule must hold everywhere.

───────────────────────────────────────────────────────────────────────────────
9. STORE LAYER: EXISTENCE vs VALUE EVENTS
───────────────────────────────────────────────────────────────────────────────
   • The store distinguishes between “the field existed and was set to
     undefined” and “the field was deleted”.
   • **Delete** → `invalidateConsumers` (withdraw quorum, retract dirty
     reports, do NOT fire).
   • **Set to undefined (manual write)** → `fireAndWithdraw` (fire a final
     value change to consumers, THEN withdraw quorum).
   • `settle` (structural reconciliation, e.g., an object replacement)
     follows the delete‑like path for vanished fields, and trigger for value
     changes.
   • ALL store helpers (`invalidateConsumers`, `revalidateConsumers`,
     `fireAndWithdraw`) **must** skip consumers that are disposed
     (`_trits[c] === 0`), or they will corrupt free‑list links.
   • The store dictionary (`store.dict`) maps dotted keys to **BigInt refs**
     (`gen * MULTIPLIER + ptr`). Deref with `Signal.deref(ref)`.

───────────────────────────────────────────────────────────────────────────────
10. MEMOIZATION TRIE & EVICTION
───────────────────────────────────────────────────────────────────────────────
    • `memo` builds a parameter trie inside `_ctx[host]`. Each leaf is an
      autonomous reactive node.
    • Eviction is FIFO, triggered when `leafQueue.length > maxSize`
      (default 10 000). The oldest leaf is disposed and removed from the trie.
    • Do NOT change the eviction logic without keeping the `trieNode.node`
      reference in sync — after eviction, that trie slot must point to null
      so the next call re‑creates the node.
    • `maxSize` can be overridden per memoized function via options.

───────────────────────────────────────────────────────────────────────────────
11. GENERATION TAGS & REFS (BigInt)
───────────────────────────────────────────────────────────────────────────────
    • `_nodeGen` is a BigUint64Array. `_globalUUID` is a BigInt that increases
      monotonically. A signal’s ref is `gen * ID_MULTIPLIER_BIG + ptr`.
    • `Signal.deref(ref)` must check `_nodeGen[ptr] === gen` AND `_trits[ptr] !== 0`.
    • `isZombie(handle)` duplicates this check. Both must always agree.
    • Never cast a BigInt ref to a Number and back — use `Number(ref % MULTIPLIER)`
      and `ref / MULTIPLIER` with BigInt arithmetic.

───────────────────────────────────────────────────────────────────────────────
12. MISCELLANEOUS BUT CRITICAL
───────────────────────────────────────────────────────────────────────────────
    • `_freeMemoryAxis` is a signed byte (Int8) indicating source/sink role for
      the reaper. Only values +1 (source), 0 (invalidate), –1 (sink) are valid.
    • `_runCount` is a Uint16 per node, used to prevent infinite loops.
      It is reset to 0 after each `flushQueue()`.
    • The LUT arrays (`LUT_R`, `LUT_E`, etc.) are 256‑entry Int8Arrays indexed
      by `trit + 128`. They extract a single axis from a packed word. Changing
      the axis weights (81,27,9,3,1) requires regenerating the LUTs.
    • `_traceEpoch` is a BigInt that increases monotonically; it won't wrap
      in practice. The kernel uses it for per‑ride edge deduplication.

═══════════════════════════════════════════════════════════════════════════════
   END OF INVARIANTS
═══════════════════════════════════════════════════════════════════════════════

   V17.0.7 — EDGE STRIDE REDUCTION (5→4) & PACKED DIRTY FLAG
═══════════════════════════════════════════════════════════════════════════════

MOTIVATION
  • Stride‑5 edge records (20 bytes) cross cache lines, causing ~30%
    unnecessary L1 misses during subscriber‑list traversal.
  • Epoch over‑allocation (5 lanes per edge) wastes 4/5 of the epoch array.
  • Division by 5 when accessing per‑edge structures (e.g. epoch) costs
    15% in hot paths.

SOLUTION
  • Reduce edge record from 5 to 4 Int32 lanes (16 bytes, power‑of‑two stride).
  • Pack the DIRTY flag into the most‑significant bit of EDGE_TARGET (lane 0).
    Node indices are always ≤ 2^20, so bit 31 is unused and collision‑free.
  • Epoch array is now one element per edge, accessed via `idx >> 2`
    (bit‑shift, zero‑cost).

NEW EDGE LAYOUT (stride = 4)
  Lane 0  – TARGET (bits 30:0 = consumer / source; bit 31 = DIRTY flag)
  Lane 1  – NEXT   (next edge in singly‑linked list, or free‑list link)
  Lane 2  – PREV_SUB (previous edge in doubly‑linked subscriber list)
  Lane 3  – PAIR   (other half of the logical edge pair)

DIRTY BIT CONTRACT (bit 31 of lane 0)
  SET    : `_edges[base] |= 0x80000000`      (OR with sign mask)
  TEST   : `if (_edges[base] < 0)`           (sign check → DIRTY)
  CLEAR  : `_edges[base] &= 0x7FFFFFFF`      (clear bit 31 only)
  REAL TARGET : `_edges[base] & 0x7FFFFFFF`  (remove flag when needed)

  The mask 0x7FFFFFFF is applied ONLY when the actual node index is read.
  In the subscriber walk (trigger), we never need the target, only its
  DIRTY state and the target node’s _trits word. Therefore the sign‑bit
  test is done directly on the loaded value, saving a second load.

INVARIANT: All locations that read EDGE_TARGET for its node index MUST
  clear bit 31 first. Use the helper `_edgeTarget(e)` or manual masking.

MEMORY IMPACT (L2 arena, 131k nodes, 524k edges)
  Before (stride‑5 + per‑lane Uint32 epoch) : 20 MB
  After  (stride‑4 + per‑edge BigUint64 epoch) : 12 MB  (−40%)

PERFORMANCE
  • Bit‑shift `>>2` is cheaper than division, enabling per‑edge epoch
    lookup in cleanup/sweep without penalty.
  • Cache line alignment is restored; 4 edges exactly fit a 64‑byte line.
  • All epoch accesses use BigInt zero/non‑zero comparison – tolerant to
    2^64 wraps, making the kernel safe for indefinite uptime.
  * PATCH: reverted to UINT32 due to speed diffs; indefinite uptime reverted to 50 days.

REFACTOR IMPACT
  • Constants EDGE_TARGET…EDGE_DIRTY replaced by EDGE_TARGET (0), EDGE_NEXT (1),
    EDGE_PREV_SUB (2), EDGE_PAIR (3). The old EDGE_DIRTY constant is removed.
  • All existing loops that walk edges are left structurally identical;
    only the extraction of DIRTY and TARGET changes.
  • The free‑list is unaffected (NEXT is still lane 1).
  • This patch must be applied atomically—mixed stride‑5 and stride‑4 edges
    will cause immediate memory corruption.

═══════════════════════════════════════════════════════════════════════════════
*/

'use strict';

const ψ = (Ctor, ...x) => x.map(size => new Ctor(size));

const CHIMERA  = Symbol.for('Chimera');

const REACTIVE_STORE = Symbol('Chimera/store');
const CHIMERA_LAYER  = Symbol('Chimera/layer');

const PENDING  = Symbol.for('Instance.??');
const POISONED = Symbol.for('Instance.!!');

const RK_RE 	= /^[$Δ]/;
const BARE_RE	= /^[$Δ]{1,3}$/;
const PREFIX_RE = /^([$Δ]{1,3})(.*)$/;
const SUFFIX_RE = /^(.*?)([$Δ]{1,3})$/;

const VERSION = version;
const TEXT_SYNC = `%c[Chimera V${VERSION}] Native V8 Arena Active (Sync).`;
const TEXT_WASM = `%c[Chimera V${VERSION}] WebAssembly Arena Active (Async).`;

const ROOT_MOUNT = 121;

const [R, E, A, C, T] = [81, 27, 9, 3, 1];
const [L1, L2, L3, L4, L5] = [1 << 16, 1 << 17, 1 << 18, 1 << 19, 1 << 20];

const Z = 128;

const [X127, X126, X125, X124, X123, X122] = [127, 126, 125, 124, 123, 122];
const [U128, U127, U126, U125, U124, U123, U122] = [-128, -127, -126, -125, -124, -123, -122];

// ── New edge stride constants for V17.0.7 ──
const EDGE_STRIDE        = 4;
const EDGE_STRIDE_SHIFT  = 2;                 // idx >> 2 → edge index
const [EDGE_TARGET, EDGE_NEXT, EDGE_PREV_SUB, EDGE_PAIR] = [0, 1, 2, 3];
// DIRTY flag is now bit 31 of lane 0; no separate lane.

const [TREE_PARENT, TREE_CHILD, TREE_SIB] = [0, 1, 2];

const [LUT_R, LUT_E, LUT_A, LUT_C, LUT_T] = ((_R, _E, _A, _C, _T) => {
	for (let i = ROOT_MOUNT; i >= -ROOT_MOUNT; i--) {
		const r = Math.round(i / R);
		const e = Math.round((i - R*r) / E);
		const a = Math.round((i - R*r - E*e) / A);
		const c = Math.round((i - R*r - E*e - A*a) / C);
		const t = i - R*r - E*e - A*a - C*c;
		_R[i + Z] = r; _E[i + Z] = e; _A[i + Z] = a; _C[i + Z] = c; _T[i + Z] = t;
	}
	return [_R, _E, _A, _C, _T];
})(...ψ(Int8Array, 256, 256, 256, 256, 256));

const STATE = [5, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const ID_MULTIPLIER = 0x200000;
const ID_MULTIPLIER_BIG = BigInt(ID_MULTIPLIER);

const VOID_NODE  = +0;
const ZERO_POINT = 128;
const QUARANTINE = -122;
const CORRUPTION = -128;

const FRESH_MIN  = +41, STALE_MAX = -41;
const EAGER_HI   = -41, EAGER_LO = -67;
const ZOMBIE_HI  = -68, ZOMBIE_LO = -94;

const TRIT_DEFAULT  = encodeTrit(+1,  0,  0,  0, -1);
const TRIT_STATE    = encodeTrit(+1,  0,  0,  0, -1);
const TRIT_COMPUTED = encodeTrit(-1, -1,  1,  0, -1);
const TRIT_EFFECT   = encodeTrit(-1,  1, -1,  0, -1);

const LOCK_DELTA   = R;
const SETTLE_DELTA = E * 2;
const DIRTY_DELTA  = R * 2;

const GATE_EAGER     = { CONSENSUS_MAX: -59,  UNION_MIN: -49  };
const GATE_LAZY      = { CONSENSUS_MAX: -113, UNION_MIN: -103 };
const GATE_TRAVERSAL = { CONSENSUS_MAX: 49,   UNION_MIN: 59   };

const DISPATCH_CONSENSUS_MAX = GATE_EAGER.CONSENSUS_MAX;
const DISPATCH_UNION_MIN     = GATE_EAGER.UNION_MIN;

const SIZES = { L1, L2, L3, L4, L5 };

const POLE = {
	R: { FRESH: 1, VOID: 0, FROZEN: 0, STALE: -1 },
	E: { PUSH: 1, DETACHED: 0, PULL: -1 },
	A: { UNION: 1, PHANTOM: 0, CONSENSUS: -1 },
	C: { DEEP: 1, ATOMIC: 0, SHALLOW: -1 },
	T: { VOLATILE: 1, UNTRACKED: 0, SEMANTIC: -1 },
};

let MAX_NODES, MAX_EDGES, EDGE_MAX_STRIDE;

let [_isFlushing, _isPaused, _isBooted] = [false, false, false];

let
	_trits, _freeMemoryAxis, _runCount, _depsCount,
	_readyCount, _edgeEpoch, _nodeTree, _nodeGen,
	_sigHead, _headDep, _pendingQueue, _zombieQueue,
	_worklist, _edges, _values, _ctx;

let [
	_edgePtr, _nodePtr, _globalUUID, _traceEpoch,
	_activePtr, _pendingHead, _pendingTail, _batchDepth,
	_zombieTail, _rootPtr, _liveNodes,
	_freeNodeHead, _freeEdgeHead,
] = STATE;

function encodeTrit(r, e, a, c, t) { return (R*r + E*e + A*a + C*c + t) }

const axis = (v, whenTrue, whenFalse) => (v ? whenTrue : whenFalse);

const _setR = (v, r) => encodeTrit(r, LUT_E[v + Z], LUT_A[v + Z], LUT_C[v + Z], LUT_T[v + Z]);
const _setE = (v, e) => encodeTrit(LUT_R[v + Z], e, LUT_A[v + Z], LUT_C[v + Z], LUT_T[v + Z]);
const _setA = (v, a) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], a, LUT_C[v + Z], LUT_T[v + Z]);
const _setC = (v, c) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], LUT_A[v + Z], c, LUT_T[v + Z]);
const _setT = (v, t) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], LUT_A[v + Z], LUT_C[v + Z], t);

const { is, is: $is, create: $create } = Object;

let allocNode = function() {
	if (_isBooted === false) init(L2);       // default L2
	_isBooted = true;
	allocNode = jsAllocNode;
	return jsAllocNode();
};

function init(size = L2) {
	const N = (MAX_NODES = size), E = (MAX_EDGES = size * 4);
	EDGE_MAX_STRIDE = E * EDGE_STRIDE;
	[ _trits, _freeMemoryAxis ] = ψ(Int8Array, N, N);
	[ _runCount, _depsCount, _readyCount ] = ψ(Uint16Array, N, N, N);
	[ _nodeTree, _edgeEpoch ] = ψ(Uint32Array, N * 3, E); // _edgeEpoch: one element per edge, BigUint64 for indefinite runtime as opposed to 50 days
	_nodeGen = new BigUint64Array(N);

	[ _sigHead, _headDep, _edges ] = ψ(Int32Array, N, N, E * EDGE_STRIDE); // _edges: EDGE_STRIDE lanes per edge
	[ _values, _ctx ] = ψ(Array, N, N);
	
	_pendingQueue = [];
	_zombieQueue  = [];
	_worklist     = [];

	[ _edgePtr, _nodePtr, _globalUUID, _traceEpoch,
	  _activePtr, _pendingHead, _pendingTail, _batchDepth,
	  _zombieTail, _rootPtr, _liveNodes,
	  _freeNodeHead, _freeEdgeHead
	] = STATE;

	_globalUUID = 0n;
	_traceEpoch = 0;                  
	_pendingHead = 0;
	_pendingTail = 0;

	_values.fill(void 0); _ctx.fill(null);
	_isFlushing = false; _isPaused = false;
}


// (js)allocNode() — identical except for BigInt gen bump
function jsAllocNode() {
	for (var ptr;;) {
		if (_freeNodeHead !== 0) { ptr = _freeNodeHead; _freeNodeHead = _headDep[ptr]; break; }
		if (_nodePtr < MAX_NODES) { ptr = _nodePtr++; break; }
		if (_zombieQueue.length > 0) { sweep(); continue; }
		throw new Error('[Chimera] arena OOM: MAX_NODES exhausted');
	}
	_nodeGen[ptr] = ++_globalUUID;
	_headDep[ptr] = 0; _sigHead[ptr] = 0;
	_nodeTree[ptr*3 + TREE_PARENT] = 0;
	_nodeTree[ptr*3 + TREE_CHILD] = 0;
	_nodeTree[ptr*3 + TREE_SIB] = 0;
	_values[ptr] = undefined; _ctx[ptr] = null;
	_runCount[ptr] = 0; _freeMemoryAxis[ptr] = 0;
	_depsCount[ptr] = 0; _readyCount[ptr] = 0;
	_liveNodes++;
	return ptr;
}

// freeNode(ptr) — unchanged
function freeNode(ptr) {
	_trits[ptr] = VOID_NODE;
	_values[ptr] = undefined; _ctx[ptr] = null;
	if (_accessorSet.size) _accessorSet.delete(ptr);
	_headDep[ptr] = _freeNodeHead;
	_freeNodeHead = ptr;
	_liveNodes--;
}


// allocEdge() — stride-4, epoch with shift
function allocEdge() {
	for (var idx;;) {
		if (_freeEdgeHead !== 0) {
			idx = _freeEdgeHead;
			_freeEdgeHead = _edges[idx + EDGE_NEXT];
			break;
		}
		if ((_edgePtr + EDGE_STRIDE) < EDGE_MAX_STRIDE) {
			idx = _edgePtr;
			_edgePtr += EDGE_STRIDE;
			break;
		}
		if (_zombieQueue.length > 0) { sweep(); continue; }
		throw new Error('[Chimera] arena OOM: MAX_EDGES exhausted');
	}
	_edges[idx + EDGE_TARGET]   = 0;
	_edges[idx + EDGE_NEXT]     = 0;
	_edges[idx + EDGE_PREV_SUB] = 0;
	_edges[idx + EDGE_PAIR]     = 0;
	_edgeEpoch[idx >> EDGE_STRIDE_SHIFT] = 0;
	return idx;
}

// freeEdge(idx) — unchanged (NEXT is still lane 1)
function freeEdge(idx) {
	_edges[idx + EDGE_NEXT] = _freeEdgeHead;
	_freeEdgeHead = idx;
}

function layer(depth, value) { return { [CHIMERA_LAYER]: depth, value }; }

// ── subscribe (V17.0.7) ──
function subscribe(consumer, source) {
	for (let dep = _headDep[consumer]; dep !== 0; dep = _edges[dep + EDGE_NEXT]) {
		if (_edges[dep + EDGE_TARGET] === source) {
			_edgeEpoch[dep >> EDGE_STRIDE_SHIFT] = _traceEpoch;
			return false;                         // edge already present — idempotent
		}
	}
	const subIdx = allocEdge();
	let depIdx;
	try { depIdx = allocEdge(); }
	catch (e) { freeEdge(subIdx); throw e; }

	try {
		_edges[subIdx + EDGE_TARGET] = consumer;
		_edges[depIdx + EDGE_TARGET] = source;
		_edges[subIdx + EDGE_PAIR] = depIdx;
		_edges[depIdx + EDGE_PAIR] = subIdx;
		_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = _traceEpoch;

		const sHead = _sigHead[source];
		_edges[subIdx + EDGE_NEXT] = sHead;
		_edges[subIdx + EDGE_PREV_SUB] = 0;
		if (sHead !== 0) _edges[sHead + EDGE_PREV_SUB] = subIdx;
		_sigHead[source] = subIdx;

		_edges[depIdx + EDGE_NEXT] = _headDep[consumer];
		_headDep[consumer] = depIdx;
		if (_trits[source] !== 0) _depsCount[consumer]++;
	} catch (e) {
		freeEdge(subIdx); freeEdge(depIdx);
		throw e;
	}
	return true;                                  // a new edge was created
}

// ── V17.0.b §2 dedup helpers (fidelity-corrected against actual code) ──
// walkSubscribers: the guarded forward walk shared by invalidate/revalidate/fireAndWithdraw.
// Early-next capture makes it safe for bodies that withdraw the current edge.
// (First rejected against a stale baseline; a same-conditions control showed the
// delta was session drift, not closure cost — accepted on contemporaneous A/B.)
function walkSubscribers(p, fn) {
	const tp = _nodeTree[p * 3 + TREE_PARENT];
	for (let sub = _sigHead[p]; sub !== 0; ) {
		const raw      = _edges[sub + EDGE_TARGET];
		const consumer = raw & 0x7FFFFFFF;
		const next     = _edges[sub + EDGE_NEXT];
		if (consumer !== 0 && consumer !== tp && _trits[consumer] !== 0) fn(consumer, raw, sub);
		sub = next;
	}
}

// dirtyConsumer: apply DIRTY_DELTA and queue if the E-axis says Push.
// Exactly 2 true sites (trigger consensus, fireAndWithdraw ready-branch);
// the union/runNode and mark-only variants deliberately stay inline.
function dirtyConsumer(consumer, cv) {
	const nv = cv - DIRTY_DELTA;
	_trits[consumer] = nv;
	if (LUT_E[nv + Z] === 1) { _pendingQueue[_pendingTail++] = consumer; return true; }
	return false;
}

// unlinkSub: pure doubly-linked removal from a signal's subscriber list.
// Split at the free/epoch seam so retargetDep's relink variant composes.
function unlinkSub(subIdx, source) {
	const p = _edges[subIdx + EDGE_PREV_SUB], n = _edges[subIdx + EDGE_NEXT];
	if (p === 0) _sigHead[source] = n; else _edges[p + EDGE_NEXT] = n;
	if (n !== 0) _edges[n + EDGE_PREV_SUB] = p;
}

// unsubscribe(consumer, source) — unchanged except masks not needed
function unsubscribe(consumer, source) {
	let prev = 0;
	for (let dep = _headDep[consumer]; dep !== 0; prev = dep, dep = _edges[dep + EDGE_NEXT]) {
		if (_edges[dep + EDGE_TARGET] !== source) continue;
		if (prev === 0) _headDep[consumer] = _edges[dep + EDGE_NEXT];
		else _edges[prev + EDGE_NEXT] = _edges[dep + EDGE_NEXT];
		const sub = _edges[dep + EDGE_PAIR];
		unlinkSub(sub, source);
		freeEdge(sub); freeEdge(dep);
		if (_depsCount[consumer] > 0 && _trits[source] !== 0) _depsCount[consumer]--;
		return true;                              // an edge was removed
	}
	return false;                                 // no such edge
}

// retargetDep(consumer, from, to) — V17.0.b §1.2 resolution: the storeDescend
// prune (unsubscribe parent + track child) preserved watcher isolation but paid
// freeEdge×2 + allocEdge×2 per level per effect-run. Since the from-edge was
// created instants earlier in the SAME synchronous read (fresh, unflagged, at
// the head of _headDep), we retarget it in place: flip the dep target, relink
// the sub side from `from`'s list into `to`'s, refresh epochs, adjust depsCount.
// Precondition: call only immediately after track(from) within one read chain.
function retargetDep(consumer, from, to) {
	if (from === to) return;
	if (to === consumer) { unsubscribe(consumer, from); return; }
	const head = _headDep[consumer];
	if (head !== 0 && _edges[head + EDGE_TARGET] === from) {
		// dedupe: if an edge to `to` already exists, drop the from-edge instead
		for (let d = _edges[head + EDGE_NEXT]; d !== 0; d = _edges[d + EDGE_NEXT])
			if (_edges[d + EDGE_TARGET] === to) {
				_edgeEpoch[d >> EDGE_STRIDE_SHIFT] = _traceEpoch;
				unsubscribe(consumer, from);
				return;
			}
		_edges[head + EDGE_TARGET] = to;
		const sub = _edges[head + EDGE_PAIR];
		unlinkSub(sub, from);
		const sh = _sigHead[to];
		_edges[sub + EDGE_NEXT] = sh;
		_edges[sub + EDGE_PREV_SUB] = 0;
		if (sh !== 0) _edges[sh + EDGE_PREV_SUB] = sub;
		_sigHead[to] = sub;
		_edgeEpoch[head >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		_edgeEpoch[sub  >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		if (_trits[from] !== 0 && _trits[to] === 0) { if (_depsCount[consumer] > 0) _depsCount[consumer]--; }
		else if (_trits[from] === 0 && _trits[to] !== 0) _depsCount[consumer]++;
		return;
	}
	// from-edge not at head (deduped earlier this run) — original two-step semantics
	unsubscribe(consumer, from);
	subscribe(consumer, to);
}

// track(sigPtr) — unchanged
function track(sigPtr) {
	const a = _activePtr;
	if (a === 0 || a === sigPtr) return;
	if (LUT_T[_trits[a] + Z] === 0) return;
	subscribe(a, sigPtr);
}

// adopt, unlinkSibling — unchanged
function adopt(parent, child) {
	if (parent === 0 || child === 0 || parent === child) return;
	unlinkSibling(child);
	_nodeTree[child * 3 + TREE_PARENT] = parent;
	_nodeTree[child * 3 + TREE_SIB] = _nodeTree[parent * 3 + TREE_CHILD];
	_nodeTree[parent * 3 + TREE_CHILD] = child;
}

function unlinkSibling(child) {
	const parent = _nodeTree[child * 3 + TREE_PARENT];
	if (parent === 0) return;
	let cur = _nodeTree[parent * 3 + TREE_CHILD], prev = 0;
	while (cur !== 0 && cur !== child) { prev = cur; cur = _nodeTree[cur * 3 + TREE_SIB]; }
	if (cur === child) {
		if (prev === 0) _nodeTree[parent * 3 + TREE_CHILD] = _nodeTree[child * 3 + TREE_SIB];
		else _nodeTree[prev * 3 + TREE_SIB] = _nodeTree[child * 3 + TREE_SIB];
	}
	_nodeTree[child * 3 + TREE_PARENT] = 0;
	_nodeTree[child * 3 + TREE_SIB] = 0;
}


// trigger(sigPtr) — V17.0.7 with packed DIRTY
function trigger(sigPtr) {
	let queued = false;
	const work = [sigPtr]; let wi = 0;
	while (wi < work.length) {
		const source = work[wi++];
		for (let e = _sigHead[source]; e !== 0; ) {
			const nx      = _edges[e + EDGE_NEXT];
			const raw     = _edges[e + EDGE_TARGET];      // bit 31 = DIRTY
			const target  = raw & 0x7FFFFFFF;             // real node index
			const isDirty = raw < 0;

			const v = _trits[target];
			if (v > 40) {
				if (LUT_A[v + Z] === -1) {               // CONSENSUS
					if (!isDirty) {
						_edges[e + EDGE_TARGET] = raw | 0x80000000;
						_readyCount[target]++;
						if (_readyCount[target] >= _depsCount[target]) {
							queued = dirtyConsumer(target, v) || queued;
							if (_sigHead[target] !== 0) work.push(target);
						}
					}
				} else {                                 // UNION / PHANTOM
					const nv = v - DIRTY_DELTA;
					_trits[target] = nv;
					if (LUT_E[nv + Z] === 1) runNode(target);
					if (_sigHead[target] !== 0) work.push(target);
				}
			}
			e = nx;
		}
	}
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

function flushQueue() {
	if (_isFlushing || _isPaused) return;
	_isFlushing = true;
	try {
		while (_pendingHead < _pendingTail) {
			const ptr = _pendingQueue[_pendingHead++];
			if (_trits[ptr] === 0) continue;
			if (_freeMemoryAxis[ptr] > 0) next(ptr);
			else runNode(ptr);
		}
	} finally {
		_isFlushing = false;
		_pendingHead = 0;
		_pendingTail = 0;
		_pendingQueue.length = 0;
		_runCount.fill(0);
	}
}

function runNode(ptr) {
	let v = _trits[ptr];
	if (v === 0) return;
	if (v < EAGER_LO || v > EAGER_HI) return;
	if (++_runCount[ptr] > 100) { _trits[ptr] = QUARANTINE; throw new Error('[Chimera V17] Topology Panic: at ' + ptr); }
	_trits[ptr] = v + LOCK_DELTA;
	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
	try {
		const fn = _ctx[ptr]?._chimeraFn || _values[ptr];
		const res = typeof fn === 'function' ? fn() : void 0;
		if (typeof res?.next === 'function') { res._chimeraFn = fn; _ctx[ptr] = res; _freeMemoryAxis[ptr] = 1; }
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error('[Chimera V17] runNode error:', e); _trits[ptr] = QUARANTINE;
	} finally { _activePtr = prevActive; }
	if (_ctx[ptr] !== null && typeof _ctx[ptr]?.next === 'function') next(ptr);
}

function detach(ptr) {
	const v = _trits[ptr];
	if (v > 40 && LUT_E[v + Z] === 1) _trits[ptr] = v - E;
}
function reattach(ptr) {
	const v = _trits[ptr];
	if (LUT_E[v + Z] !== 0) return;          // only resurrect a parked (Detached) node
	_trits[ptr] = _setR(v + E, -1);          // Detached→Push and force Stale: the run IS the re-subscription
	runNode(ptr);
}

// recompute(ptr) — V17.0.7 with DIRTY clear via bit-31
function recompute(ptr) {
	let v = _trits[ptr];
	if (v >= -40) return;
	_trits[ptr] = v + LOCK_DELTA;
	const fn = _values[ptr];
	if (typeof fn !== 'function') {
		_readyCount[ptr] = 0;
		let d = _headDep[ptr];
		while (d !== 0) {
			const sub = _edges[d + EDGE_PAIR];
			if (sub !== 0) _edges[sub + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY
			recompute(_edges[d + EDGE_TARGET]);
			d = _edges[d + EDGE_NEXT];
		}
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
		return;
	}
	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
	try {
		_ctx[ptr] = fn();
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error('[Chimera V17] recompute error:', e); _trits[ptr] = QUARANTINE;
	} finally { _activePtr = prevActive; }
}

// disposeChildren(ptr): owned children die with the owner — tag each for disposal (iterative via the queue).
function disposeChildren(ptr) {
	let child = _nodeTree[ptr * 3 + TREE_CHILD];
	while (child !== 0) {
		const nx = _nodeTree[child * 3 + TREE_SIB];
		_nodeTree[child * 3 + TREE_PARENT] = 0; _nodeTree[child * 3 + TREE_SIB] = 0;
		tagForDisposal(child);
		child = nx;
	}
	_nodeTree[ptr * 3 + TREE_CHILD] = 0;
}

// hasExternalReader(p): true if any subscriber of p is NOT its structural tree‑parent (something external reads it).
function hasExternalReader(p) {
	const tp = _nodeTree[p * 3 + TREE_PARENT];
	for (let sub = _sigHead[p]; sub !== 0; sub = _edges[sub + EDGE_NEXT])
		if ((_edges[sub + EDGE_TARGET] & 0x7FFFFFFF) !== tp) return true;
	return false;
}

// next(ptr): generator / async‑iterator resumption (fma=+1 sources). Advance one step, store the yielded
// value, mark Fresh, and notify subscribers; a thenable yield awaits and resumes on resolution.
function next(ptr) {
	if (_trits[ptr] === 0) return;                        // disposed
	let iter = _ctx[ptr];
	if (!iter || typeof iter.next !== 'function' || iter._isAwaiting) {
		const fn = iter?._chimeraFn || _values[ptr];
		if (typeof fn !== 'function') return;
		iter = fn();
		if (!iter || typeof iter.next !== 'function') return;
		iter._chimeraFn = fn; _ctx[ptr] = iter;
	}
	const savedGen = _nodeGen[ptr], prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	try {
		const result = iter.next(_values[ptr]);
		_activePtr = prevActive;
		if (result.done) {
			_values[ptr] = result.value;
			_ctx[ptr] = { _chimeraFn: iter._chimeraFn };
			if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
			return;
		}
		const yielded = result.value;
		if (typeof yielded?.then === 'function') {
			iter._isAwaiting = true;
			yielded.then(val => {
				if (_nodeGen[ptr] !== savedGen || _ctx[ptr] !== iter) return;
				iter._isAwaiting = false;
				_values[ptr] = val;
				if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
				trigger(ptr);
			});
		} else {
			_values[ptr] = yielded;
			if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
			trigger(ptr);
		}
	} catch (e) {
		console.error('[Chimera V17] next error:', e); _trits[ptr] = QUARANTINE;
	} finally {
		if (_activePtr === ptr) _activePtr = prevActive;
	}
}

// freeze(ptr): R -> 0. A live node (Fresh or Stale) becomes a static snapshot — readable, inert, and
// distinct from the all‑zero graveyard. trigger skips it for free (it is no longer Fresh).
function freeze(ptr) {
	const v = _trits[ptr];
	if (v >= -40 && v <= 40) return;                      // already inert/frozen/disposed
	_trits[ptr] = _setR(v, POLE.R.VOID);
}

// unfreeze(ptr): R 0 -> -1 (Stale) then recompute — the re‑sync handshake. A frozen node has lost its old
// Fresh/Stale standing, so it re‑ticks against current inputs rather than trusting a relic value.
function unfreeze(ptr) {
	const v = _trits[ptr];
	if (v > 40 || v < -40 || v === 0) return;             // only a frozen (R=0, non‑disposed) node
	_trits[ptr] = _setR(v, POLE.R.STALE);
	recompute(ptr);
}

function tagForDisposal(ptr) {
	if (_trits[ptr] === 0) return;
	_trits[ptr] = 0;
	_zombieQueue.push(ptr);
	if (_zombieQueue.length >= 1024) sweep();
}

// cleanupDeps(ptr, reap) — V17.0.7, stride-4, DIRTY packed
function cleanupDeps(ptr, reap) {
	_depsCount[ptr] = 0; _readyCount[ptr] = 0;
	let depIdx = _headDep[ptr];
	while (depIdx !== 0) {
		const subIdx = _edges[depIdx + EDGE_PAIR];
		const signal = _edges[depIdx + EDGE_TARGET];
		const nx     = _edges[depIdx + EDGE_NEXT];

		if (subIdx !== 0) {
			unlinkSub(subIdx, signal);
			freeEdge(subIdx);
			_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = 0;
		}

		_edges[depIdx + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY on dep edge (safety)
		freeEdge(depIdx);
		_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = 0;

		if (reap && signal !== 0 && signal !== ptr &&
			_nodeTree[signal * 3 + TREE_PARENT] !== 0 &&
			_nodeTree[signal * 3 + TREE_CHILD] === 0 &&
			!hasExternalReader(signal))
			tagForDisposal(signal);

		depIdx = nx;
	}
	_headDep[ptr] = 0;
}

// sweep() — V17.0.7 with packed DIRTY
function sweep() {
	const frontier = [];
	while (_zombieQueue.length > 0) {
		const ptr = _zombieQueue.pop();
		if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
		unlinkSibling(ptr);
		cleanupDeps(ptr, 1);

		let subIdx = _sigHead[ptr];
		while (subIdx !== 0) {
			const depIdx   = _edges[subIdx + EDGE_PAIR];
			const rawSub   = _edges[subIdx + EDGE_TARGET];
			const consumer = rawSub & 0x7FFFFFFF;
			const wasDirty = rawSub < 0;
			const nextSub  = _edges[subIdx + EDGE_NEXT];

			const cv = consumer !== 0 ? _trits[consumer] : 0;
			if (cv !== 0) {
				if (wasDirty && _readyCount[consumer] > 0) _readyCount[consumer]--;
				if (_depsCount[consumer] > 0) _depsCount[consumer]--;

				if (cv > 40) {
					const eAxis = LUT_E[cv + Z];
					if (eAxis === 1) {
						if (_depsCount[consumer] === 0) _trits[consumer] = cv - E;
					} else if (eAxis === -1 && _freeMemoryAxis[ptr] <= 0) {
						frontier.push(consumer);
					}
				}
			}

			if (depIdx !== 0) {
				let prev = 0;
				let cur = _headDep[consumer];
				while (cur !== 0 && cur !== depIdx) { prev = cur; cur = _edges[cur + EDGE_NEXT]; }
				if (cur === depIdx) {
					if (prev === 0) _headDep[consumer] = _edges[depIdx + EDGE_NEXT];
					else _edges[prev + EDGE_NEXT] = _edges[depIdx + EDGE_NEXT];
				}
				_edges[depIdx + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY
				freeEdge(depIdx);
				_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = 0;
			}

			freeEdge(subIdx);
			_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = 0;
			subIdx = nextSub;
		}

		_sigHead[ptr] = 0;
		_nodeTree[ptr * 3 + TREE_PARENT] = 0;
		_nodeTree[ptr * 3 + TREE_CHILD]  = 0;
		_nodeTree[ptr * 3 + TREE_SIB]    = 0;
		_values[ptr] = undefined;
		_ctx[ptr]    = null;	
		_headDep[ptr] = _freeNodeHead;
		_freeNodeHead = ptr;
		_liveNodes--;
	}

	for (let i = 0; i < frontier.length; i++) {
		const consumer = frontier[i];
		const ev0 = _trits[consumer];
		if (ev0 > 40 && LUT_E[ev0 + Z] === -1) _trits[consumer] = (ev0 - DIRTY_DELTA);
	}
}

// ── Store helpers (updated with disposed‑consumer guard) ──
function invalidateConsumers(p) {
	walkSubscribers(p, (consumer, raw, sub) => {
		if (raw < 0) {
			_edges[sub + EDGE_TARGET] &= 0x7FFFFFFF;
			if (_readyCount[consumer] > 0) _readyCount[consumer]--;
		}
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
	});
}

function revalidateConsumers(p) {
	walkSubscribers(p, (consumer) => {
		if (_trits[consumer] > -40) _depsCount[consumer]++;
	});
}

function fireAndWithdraw(p) {
	let queued = false;
	walkSubscribers(p, (consumer, raw, sub) => {
		const cv = _trits[consumer];
		if (cv <= -40) return;
		if (cv > 40 && LUT_E[cv + Z] === -1 && typeof _values[consumer] === 'function') {
			if (_depsCount[consumer] > 0) _depsCount[consumer]--;
			_trits[consumer] = cv - DIRTY_DELTA;      // mark-only: computed goes stale, never queued
			return;
		}
		if ((raw & 0x80000000) === 0) { _edges[sub + EDGE_TARGET] |= 0x80000000; _readyCount[consumer]++; }
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
		if (cv > 40 && (LUT_A[cv + Z] === 1 || _readyCount[consumer] >= _depsCount[consumer]))
			queued = dirtyConsumer(consumer, cv) || queued;
	});
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

// Cell I/O (unchanged)
function get(ptr) {
	const v = _trits[ptr];
	if (v === 0) return undefined;
	if (v < -40) recompute(ptr);
	track(ptr);
	const locus = _values[ptr];
	// V17.0.b §1.1: cell I/O stays lean — object-proxy wrapping lives in
	// storeRead/storeDescend (store fields) and memo/createDeepProxy (computed results).
	return typeof locus === 'function' ? _ctx[ptr] : locus;
}

function rawget(ptr) {
	const v = _trits[ptr];
	if (v === 0) return undefined;
	if (v < -40) recompute(ptr);
	const locus = _values[ptr];
	return typeof locus === 'function' ? _ctx[ptr] : locus;
}

function set(ptr, val) {
	const v = _trits[ptr];
	if (v === 0) return;
	if (v >= -40 && v <= 40) { _values[ptr] = val; return; }
	const changed = !is(_values[ptr], val);
	_values[ptr] = val;
	if (LUT_T[v + Z] === 1 || changed) trigger(ptr);
}


function silentSet(ptr, val) { // guard 
	const v = _trits[ptr];
	if (v === 0) return;
	_values[ptr] = val;
}


function rawset(ptr, val) {
	if (_trits[ptr] === 0) return;
	_values[ptr] = val;
	trigger(ptr);
}

// Layer 5 helpers (unchanged)
const isRK = p => typeof p === 'string' && RK_RE.test(p) && !BARE_RE.test(p);
const isUnion = s => s.includes('Δ');
const sigilDepth = s => { const m = /^[$Δ]+/.exec(s); const n = m ? m[0].length : 0; return n >= 2 ? Infinity : n === 1 ? 1 : 0; };
const isClass = x => typeof x === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(x));
const isScope = x => x === null || isClass(x) || (typeof x === 'object' && x !== null && x[REACTIVE_STORE]);

function _getGlobal() {
	if (_rootPtr === 0) { _rootPtr = allocNode(); _trits[_rootPtr] = ROOT_MOUNT; }
	return Signal(_rootPtr);
}

function graft(to, from, skip) {
	for (const key of Reflect.ownKeys(from))
		if (!skip.includes(key)) Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key));
	return to;
}

function isZombie(handle) {
	if (!handle || typeof handle.ptr !== 'number') return true;
	const p = handle.ptr;
	return p <= 0 || p >= MAX_NODES || _trits[p] === 0 || handle.gen !== _nodeGen[p];
}

class $Signal extends null {

	static #ref = null;
	static State = class State extends Signal {};
	static Computed = class Computed extends Signal {};
	static Effect = class Effect extends Signal {};

	static Store = class Store {

		#memoized = null;   // factory (memo) mode — set when constructed with a function
		#deep = false;      // manual-mode reads wrap objects in a tracking proxy
		#union = false;

		/* Unified door (0.87.7): one constructor, four cases —
		 *   new Store()                    → empty manual store (default engine)
		 *   new Store(engineHandle)        → manual store on that engine (existing API)
		 *   new Store({ seed })            → manual store, entries written verbatim
		 *   new Store(factoryFn, options)  → memo mode: get(...args) computes via the
		 *                                    factory through memo()'s trie cache
		 *                                    (options: union, deep, maxSize, effect)
		 * The manual surface (write/read/has/_silentWrite/$-triads) is unchanged. */
		constructor(data, options = {}) {
			let engine = null, factory = null, seed = null;
			if (typeof data === 'function') factory = data;
			else if (data !== null && typeof data === 'object') {
				const isHandle = typeof data.ptr === 'number' && typeof data.get === 'function';
				if (isHandle) engine = data;
				else if (!Array.isArray(data)) seed = data;
			}
			if (!factory && typeof options.factory === 'function') factory = options.factory;
			this.engine = engine ?? _getGlobal();
			this.dict = new Map();
			this._proxies = new Map();
			this._quorum = new Map();   // dotted parent name -> Set<changed child key> (consensus barrier state)
			this.#deep = !!options.deep;
			this.#union = !!options.union;
			this._cascade = options.cascade;     // V17.0.b §1.3 amended: undefined → consensus cascades, union skips; boolean overrides
			if (factory) this.#memoized = memo(factory, options);
			if (seed) for (const k of Object.keys(seed)) this.write(k, seed[k]);
		}

		get isMemo() { return this.#memoized !== null; }

		get(...args) {
			if (this.#memoized) return this.#memoized(...args);
			if (!args.length) return undefined;
			const key = args[0];
			// Map-like get: missing key → undefined, no node materialization.
			// (Kernel storeRead creates cells on miss for subscribe-before-set —
			// that behavior stays available through the read() alias.)
			if (!this.dict.has(key)) return undefined;
			const v = this.read(key);
			if (!this.#deep || v === null || typeof v !== 'object') return v;
			let p = this._proxies.get(key);          // storeWrite invalidates this on change
			if (!p) {
				const ref = this.dict.get(key);
				const node = ref != null ? Signal.deref(ref) : null;
				if (!node) return v;
				p = createDeepProxy(v, Infinity, node.ptr, this.#union);
				this._proxies.set(key, p);
			}
			return p;
		}

		set(key, val) {
			if (this.#memoized) throw new Error('[Chimera] Store(factory): set() unavailable — values are computed; use get(...args)');
			this.write(key, val);
			return this;
		}

		/* per-key management — one contract, both modes (0.87.8) */
		delete(...args) {
			if (this.#memoized) return this.#memoized.delete(...args);
			const key = args[0];
			const ref = this.dict.get(key);
			if (ref == null) return false;
			const node = Signal.deref(ref);
			if (node) { tagForDisposal(node.ptr); sweep(); }
			this.dict.delete(key);
			this._proxies.delete(key);
			return true;
		}

		clear() {
			if (this.#memoized) { this.#memoized.clear(); return this; }
			let any = false;
			for (const ref of this.dict.values()) {
				const node = Signal.deref(ref);
				if (node) { tagForDisposal(node.ptr); any = true; }
			}
			if (any) sweep();
			this.dict.clear(); this._proxies.clear(); this._quorum.clear();
			return this;
		}

		get size() {
			if (this.#memoized) return this.#memoized.size;
			let n = 0;
			for (const ref of this.dict.values()) {
				const node = Signal.deref(ref);
				if (node && _trits[node.ptr] > 40) n++;
			}
			return n;
		}

		write(key, val) { storeWrite(this, key, val); return true; }
		read(key) { return storeRead(this, key); }

		has(...args)  { 
			if (this.#memoized) return this.#memoized.has(...args);
			const r = this.dict.get(args[0]); 
			return r != null && !!Signal.deref(r);
		}

		_silentWrite(key, val) {
			const ref = this.dict.get(key);
			if (ref != null) {
				const node = Signal.deref(ref);
				if (node) silentSet(node.ptr, val);
			}
		}

		get $()   { return triad(this, '$',   false); }
		get $$()  { return triad(this, '$$',  false); }
		get $$$() { return triad(this, '$$$', false); }
		get ['@'](){ return triad(this, '@',  false); }   // atomic active effect — this['@'](() => {})
		get ø()   { return triad(this, 'ø',   false); }   // atomic — the ø-spelled tier
		get ψ()   { return psiChain(this, this); }        // chainable seeding functor — store face
		ψFor(owner) { return psiChain(this, owner); }     // element face: unwrap returns the element
		get Δ()   { return triad(this, 'Δ',   true);  }
		get ΔΔ()  { return triad(this, 'ΔΔ',  true);  }
		get ΔΔΔ() { return triad(this, 'ΔΔΔ', true);  }
	};

	get ref()  { return this.gen * ID_MULTIPLIER_BIG + BigInt(this.ptr); }

	static deref(ref) {
		if (typeof ref !== 'bigint') return;
		const ptr = Number(ref % ID_MULTIPLIER_BIG);
		const gen = ref / ID_MULTIPLIER_BIG;
		if (ptr <= 0 || ptr >= MAX_NODES || _nodeGen[ptr] !== gen || _trits[ptr] === 0) return;
		return Signal(ptr);
	}

	static init(size = 'L2') {
		void init(SIZES[size] ?? SIZES.L2);
		const rootPtr = allocNode();
		_trits[rootPtr] = ROOT_MOUNT;
		return ($Signal.#ref = Signal(rootPtr));
	}

	static get() { return $Signal.#ref || new Substrate('L2'); }

	static teardown() { // Pass Q4: release the arena — drop the root and re-init to the smallest slab (L1). The old typed arrays and value lanes are unreferenced (GC'd); EVERY existing handle, store, and effect is invalidated. Next Signal.get() re-bootstraps fresh.
		$Signal.#ref = null;
		init(L1);
		return true;
	}

	// ── handle API ──
	attach() { return this.reattach(); }
	get()  { return isZombie(this) ? undefined : get(this.ptr); }
	peek() { return isZombie(this) ? undefined : rawget(this.ptr); }
	[Symbol.toPrimitive](hint) {
		// 'default' → peek(): console/equality coercion must NOT subscribe.
		// explicit 'number'/'string' logic → get(): tracked, like $count.
		const v = (hint === 'default') ? this.peek() : this.get();
		if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
		if (hint === 'string') return v != null ? String(v) : '';
		return v;
	}
	set(v) { if (isZombie(this)) return this; const s = _accessorSet.get(this.ptr); if (s) s.call(this, v); else set(this.ptr, v); return this; }
	poke(v){ if (isZombie(this)) return this; rawset(this.ptr, v); return this; }
	dispose() { if (!isZombie(this)) { tagForDisposal(this.ptr); sweep(); } }
	detach() { if (isZombie(this)) return this; detach(this.ptr); return this; }
	reattach() { if (isZombie(this)) return this; reattach(this.ptr); return this; }
	freeze() { if (isZombie(this)) return this; freeze(this.ptr); return this; }
	unfreeze() { if (isZombie(this)) return this; unfreeze(this.ptr); return this; }
	keep() { if (isZombie(this)) return this; adopt(_getGlobal().ptr, this.ptr); return this; }

	map(fn) { return _wire(TRIT_COMPUTED, () => fn(this.get()), 0); }
	filter(pred) {
		let last = this.peek();
		return _wire(TRIT_COMPUTED, () => { const v = this.get(); if (pred(v)) last = v; return last; }, 0);
	}
	combine(o, fn) { return _wire(TRIT_COMPUTED, () => fn(this.get(), o && typeof o.get === 'function' ? o.get() : o), 0); }
	effect(fn) { if (isZombie(this)) return undefined; const c = _wire(TRIT_EFFECT, fn, -1); adopt(this.ptr, c.ptr); return c; }
	untrack(fn) { const prev = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = prev } }

	static batch(fn) { _batchDepth++; try { return fn(); } finally { if (--_batchDepth === 0) flushQueue(); } }
	static untrack(fn) { const prev = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = prev; } }
	static wipe() { sweep(); }

	static subscribe(consumer, source) {
		return subscribe(
			typeof consumer === 'number' ? consumer : consumer && consumer.ptr,
			typeof source === 'number' ? source : source && source.ptr
		);
	}
	static unsubscribe(consumer, source) {
		return unsubscribe(
			typeof consumer === 'number' ? consumer : consumer && consumer.ptr,
			typeof source === 'number' ? source : source && source.ptr
		);
	}

	static find(scope, key, query = 'value') {
		if (scope == null || typeof key !== 'string') return undefined;
		const store = scope[REACTIVE_STORE];
		if (!store) return undefined;
		const cleanKey = key.endsWith('()') ? key.slice(0, -2) : key;
		const ref = store.dict.get(cleanKey);
		if (query === 'id') return ref != null ? Number(ref / ID_MULTIPLIER_BIG) : undefined;
		if (query === 'node' || key.endsWith('()')) return ref != null ? Signal.deref(ref) : undefined;
		return store.read(cleanKey);
	}

	static subtle = {
		Watcher: class Watcher {
			constructor(notifyFn) {
				if (typeof notifyFn !== 'function') throw new TypeError('Watcher expects a callback');
				this._notify = notifyFn;
				this._node = _wire(encodeTrit(-1, -1, -1, 0, -1), () => this._notify(), 0);
			}
			watch(...signals) {
				const prev = _activePtr; _activePtr = this._node.ptr;
				for (const sig of signals) if (sig instanceof Signal) track(sig.ptr);
				_activePtr = prev;
				const v = _trits[this._node.ptr];
				if (LUT_E[v + Z] === -1) _trits[this._node.ptr] = v + SETTLE_DELTA;
			}
			unwatch() { cleanupDeps(this._node.ptr); }
		}
	};

	static {
		Object.setPrototypeOf(Signal.prototype, null);
		graft(Signal.prototype, $Signal.prototype, ['constructor']);
		graft(Signal, $Signal, ['length', 'name', 'prototype']);
	}
}


function _wire(trit, val, free) {
	const ptr = allocNode();
	_trits[ptr] = trit;
	_values[ptr] = val;
	if (free) _freeMemoryAxis[ptr] = free;
	if (_activePtr !== 0) adopt(_activePtr, ptr);
	if (trit >= EAGER_LO && trit <= EAGER_HI) runNode(ptr);
	return Signal(ptr);
}

function reactive(target) {
	const store = new Signal.Store(_getGlobal());
	const members = new Set();
	const effects = [];
	scanClass(target, store, effects, members);
	const proxy = new Proxy(target, {
		get(t, prop, r) {
			if (prop === REACTIVE_STORE) return store;
			if (isRK(prop)) return members.has(prop) ? Reflect.get(t, prop, r) : storeRead(store, prop);
			return Reflect.get(t, prop, r);
		},
		set(t, prop, v, r) {
			if (isRK(prop)) { storeWrite(store, prop, v); return true; }
			return Reflect.set(t, prop, v, r);
		},
		has(t, prop) { return store.dict.has(prop) || Reflect.has(t, prop); },
		ownKeys(t) { return [...new Set([...Reflect.ownKeys(t), ...store.dict.keys()])]; },
		getOwnPropertyDescriptor(t, prop) {
			return (!members.has(prop) && store.dict.has(prop))
				? { enumerable: true, configurable: true, writable: true }
				: Reflect.getOwnPropertyDescriptor(t, prop);
		},
		deleteProperty(t, prop) {
			if (!members.has(prop) && store.dict.has(prop)) {
				const n = Signal.deref(store.dict.get(prop));
				if (n) (LUT_E[_trits[n.ptr] + Z] >= 0 ? n.detach() : n.dispose());
				return true;
			}
			return Reflect.deleteProperty(t, prop);
		}
	});
	registerActiveEffects(proxy, store, effects);
	return proxy;
}

// Descriptor form (single-arg object): maps 1:1 onto the five balanced-ternary
// axes by canonical pole name. Unspecified axes fall back to value-type defaults;
// `options.trit` is a raw escape hatch for the power user.
const AXIS = {
	return:    { fresh: 1, void: 0, frozen: 0, stale: -1 },   // R — Lifecycle
	effect:    { push: 1, detached: 0, pull: -1 },            // E — Eval
	affect:    { union: 1, phantom: 0, consensus: -1 },       // A — Gating
	capture:   { deep: 1, atomic: 0, shallow: -1 },           // C — Capture
	threshold: { volatile: 1, untracked: 0, semantic: -1 },   // T — Tracking
};
const _DESC_KEYS = new Set(['scope', 'key', 'value', 'get', 'set', 'options']);
const _accessorSet = new Map();   // ptr -> custom setter fn (writable-accessor descriptors); cleared on freeNode
const isDescriptor = a => {
	if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
	const ks = Object.keys(a);
	return ks.length > 0 && ks.every(k => _DESC_KEYS.has(k));
};

function Signal(a, b, c, d) {
	switch (new.target) {
		case void 0: {
			const node = $create(Signal.prototype);
			node.ptr = a;
			node.gen = _nodeGen[a];
			return node;
		}
		case Signal: case Signal.State: case Signal.Computed: case Signal.Effect: {
			let scope = null, key = null, value = undefined, opts = {};
			switch (arguments.length) {
				case 0: throw new TypeError('Signal requires an argument');
				case 1:
					if (isDescriptor(a)) {
						const o = a.options || {};
						const hasGet = 'get' in a, hasSet = 'set' in a, hasVal = 'value' in a;
						if (hasVal && (hasGet || hasSet))
							throw new TypeError('Invalid Signal descriptor: a value cannot coexist with an accessor (get/set)');
						const dv = hasGet ? a.get : a.value;               // `get` is the accessor (computed) form
						const fn = typeof dv === 'function';
						const eAx = AXIS.effect[o.effect]       ?? (fn ? (hasGet ? -1 : 1) : 0);              // accessor → Pull, value-fn → Push
						const rAx = AXIS.return[o.return]       ?? (fn ? -1 : 1);                             // fn starts Stale, value Fresh
						const aAx = AXIS.affect[o.affect]       ?? (fn ? (eAx === 1 ? -1 : eAx === -1 ? 1 : 0) : 0); // Push→Consensus, Pull→Union
						const cAx = AXIS.capture[o.capture]     ?? 0;
						const tAx = AXIS.threshold[o.threshold] ?? (hasGet ? 1 : -1);     // a (reactive) getter is Volatile by contract; values/effects default Semantic
						scope = a.scope ?? null;
						key   = (typeof a.key === 'string') ? a.key : null;
						value = dv;
						opts  = { _trit: o.trit ?? encodeTrit(rAx, eAx, aAx, cAx, tAx), free: o.free ?? (eAx === 1 ? -1 : 0), _setter: hasSet ? a.set : undefined };
					} else value = a;
					break;
				case 2: if (isScope(a)) { scope = a; value = b; } else { value = a; opts = b || {}; } break;
				case 3: if (isScope(a)) { scope = a; value = b; if (typeof c === 'string') key = c; else opts = c || {}; }
						else { value = a; key = typeof b === 'string' ? b : null; opts = c || {}; } break;
				default: scope = a; value = b; key = c; opts = d || {}; break;
			}

			let isFn = typeof value === 'function';
			let isGen = isFn && /GeneratorFunction/.test(value.constructor?.name || '');
			let isEffect = isFn && !opts.computed && !opts.defer;
			if (new.target === Signal.State) { isFn = isGen = isEffect = false; }
			else if (new.target === Signal.Computed) { if (typeof value !== 'function') throw new TypeError('Computed expects a function'); isFn = true; isGen = isEffect = false; }
			else if (new.target === Signal.Effect) { if (typeof value !== 'function') throw new TypeError('Effect expects a function'); isFn = isEffect = true; isGen = false; }

			const xR = isFn ? -1 : 1;
			const xE = isEffect ? 1 : isFn ? -1 : 0;
			const xA = opts.union ? 1 : opts.interrupt ? 1 : isFn ? (isEffect ? -1 : 1) : 0;
			const xC = opts.deep ? 1 : opts.shallow ? -1 : 0;
			const xT = opts.volatile ? 1 : opts.untracked ? 0 : -1;
			const trit = opts._trit ?? encodeTrit(xR, xE, xA, xC, xT);
			const free = opts.free ?? (isGen ? 1 : isEffect ? -1 : 0);
			const node = _wire(trit, value, free);
			if (opts._setter) _accessorSet.set(node.ptr, opts._setter);
			if (scope && scope[REACTIVE_STORE] && typeof key === 'string')
				scope[REACTIVE_STORE].dict.set(key, node.ref);
			return node;
		}
		default: return reactive($create(new.target.prototype));
	}
}

let arena = _getGlobal();
function getEngine() { return _getGlobal(); }

class Substrate extends Signal {
	static wipe() { sweep(); }
	constructor(config = {}) {
        if (typeof config === 'string') config = { size: config };
        const size = config.size ?? 'L2';

        // -- BRANCH B: WASM Upgrade (Async, Opt-in) --
        if (config.wasm) {
            return (async () => {
                try {
                    const N = SIZES[size] ?? SIZES.L2;
                    const EDGES = N * 4;
                    
                    // Assuming _loadKernel resolves the WebAssembly instance
                    const ex = (await _loadKernel(config.wasm)).exports;
                    const buf = ex.memory.buffer;

                    // V17 Numeric Arena - Mapped to WASM Linear Memory
                    _trits          = new Int8Array      (buf, ex.TRITS_PTR.value, N);
                    _freeMemoryAxis = new Int8Array      (buf, ex.FREE_MEMORY_AXIS_PTR.value, N);
                    _runCount       = new Uint16Array    (buf, ex.RUN_COUNT_PTR.value, N);
                    _depsCount      = new Uint16Array    (buf, ex.DEPS_COUNT_PTR.value, N);
                    _readyCount     = new Uint16Array    (buf, ex.READY_COUNT_PTR.value, N);
                    _nodeTree       = new Uint32Array    (buf, ex.NODE_TREE_PTR.value,  N * 3);
                    _edgeEpoch      = new Uint32Array    (buf, ex.EDGE_EPOCH_PTR.value, EDGES); // Uint32 (Speed constraint)
                    _sigHead        = new Int32Array     (buf, ex.SIG_HEAD_PTR.value, N);
                    _headDep        = new Int32Array     (buf, ex.HEAD_DEP_PTR.value, N);
                    _edges          = new Int32Array     (buf, ex.EDGES_PTR.value, EDGES * 4); // V17 Stride-4
                    _nodeGen        = new BigUint64Array (buf, ex.NODE_GEN_PTR.value, N); // V17 ABA Defense
                    
                    // Note: If pending/zombie queues remain in JS, leave them as JS arrays.
                    // If WASM manages the sweep/flush, map them here:
                    // _pendingQueue   = new Int32Array(buf, ex.PENDING_PTR.value, N);
                    // _zombieQueue    = new Int32Array(buf, ex.ZOMBIE_PTR.value, N);

                    // JS-only arrays hold live object refs -- they cannot live in linear memory
                    [_values, _ctx] = ψ(Array, N, N);

                    // Sync Global Bounds
                    MAX_NODES = N;
                    MAX_EDGES = EDGES;
                    EDGE_MAX_STRIDE = EDGES * EDGE_STRIDE;

                    // Sync Cursors & Epochs
                    _nodePtr = 1; 
                    _edgePtr = EDGE_STRIDE; // Start at index 4 (lane 0 of second edge)
                    _freeNodeHead = 0;
                    _freeEdgeHead = 0;
                    _globalUUID = 0n;
                    _traceEpoch = 0;

                    // Hot-swap the kernel core to the WASM exports
                    allocNode = ex.allocNode;
                    flushQueue = ex.flushQueue;
                    // trigger = ex.trigger; 
                    // sweep = ex.sweep;

                    const rootPtr = allocNode();
                    _trits[rootPtr] = ROOT_MOUNT;
                    const root = Signal(rootPtr);
                    graft(root, Substrate.prototype, ['constructor']);
                    
                    console.log(TEXT_WASM, 'color: #10b981;');
                    return (arena = root);

                } catch (e) {
                    console.warn('[Chimera V17] WASM upgrade failed; falling back to native JS.', e?.message || e);
                    return new Substrate({ size, wasm: false });
                }
            })();
        }

        // -- BRANCH A: Native JS Arena (Sync, Fallback) --
        const root = Signal.init(size);
        graft(root, Substrate.prototype, ['constructor']);
        console.log(TEXT_SYNC, 'color: #f59e0b;');
        return (arena = root);
    }

	get activeNodes() { return _liveNodes; }
	get density() { return _nodePtr / (MAX_NODES || 1); }

	pause() { _isPaused = true; }
	resume() { _isPaused = false; flushQueue(); }
	signal(key, value, opts = {}) {
		let depth = 0, raw = value;
		if (raw !== null && typeof raw === 'object' && raw[CHIMERA_LAYER] !== void 0) { depth = raw[CHIMERA_LAYER]; raw = raw.value; }
		else if (typeof opts.layer === 'number') depth = opts.layer;
		else if (opts.deep) depth = Infinity;
		let trit = opts._trit ?? encodeTrit(1, 1, 1, -1, -1);
		if (depth > 0) trit = _setA(trit, depth === 1 ? -1 : 1);
		return _wire(trit, raw, opts.free | 0);
	}
}

// Store reconciliation helpers (unchanged except dirty bit handling)
function settle(p, prev, next) { if (next === undefined) invalidateConsumers(p); else trigger(p); }
function settleManual(p, prev, next) { if (next === undefined) { if (prev !== undefined) fireAndWithdraw(p); } else trigger(p); }

function reconcileSubtree(store, name, oldVal, newVal) {
	const oldObj = oldVal !== null && typeof oldVal === 'object';
	const newObj = newVal !== null && typeof newVal === 'object';
	if (!oldObj && !newObj) return;
	const dict = store.dict;
	const keys = new Set();
	if (oldObj) { for (const kk in oldVal) keys.add(kk); if (Array.isArray(oldVal)) keys.add('length'); }
	if (newObj) { for (const kk in newVal) keys.add(kk); if (Array.isArray(newVal)) keys.add('length'); }
	for (const kk of keys) {
		const childName = name + '.' + kk;
		const r = dict.get(childName);
		if (r == null) continue;
		const cn = Signal.deref(r);
		if (!cn) continue;
		const p = cn.ptr;
		const nv = newObj ? newVal[kk] : undefined;
		const prevVal = _values[p];
		if (is(prevVal, nv)) continue;
		_values[p] = nv;
		store._proxies.delete(childName);
		reconcileSubtree(store, childName, oldObj ? oldVal[kk] : undefined, nv);
		if (nv === undefined && _nodeTree[p * 3 + TREE_CHILD] === 0 && !hasExternalReader(p)) {
			dict.delete(childName); tagForDisposal(p);
		} else settle(p, prevVal, nv);
	}
}

function mintField(val) {
	const prev = _activePtr; _activePtr = 0;
	try { return _wire(TRIT_STATE, val, 0); } finally { _activePtr = prev; }
}

function storeMode(key) {
	const m = /^[$Δ]+/.exec(key);
	const n = m ? m[0].length : 0;
	return n >= 2 ? 'deep' : n === 1 ? 'shallow' : 'atomic';
}

// cascadeUp — hierarchical consensus/union barrier for deep fields.
// A leaf (or a sub-tree that just fired) propagates upward; at each ancestor we
// gate on that parent node's A axis read straight from the trit: Union (+1) fires
// on any single child; Consensus (-1) fires only once every child has fired since
// the parent last fired. The barrier state lives in store._quorum (a changed-key
// Set per dotted parent name) and clears on fire, so a new transaction re-arms.
function cascadeUp(store, childName) {
	let name = childName;
	for (;;) {
		const cut = name.lastIndexOf('.');
		if (cut < 1) return;                              // reached the field root — done
		const parentName = name.slice(0, cut);
		const childKey   = name.slice(cut + 1);
		const pRef  = store.dict.get(parentName);
		const pNode = pRef != null ? Signal.deref(pRef) : null;
		if (!pNode) return;
		const pObj = _values[pNode.ptr];
		if (pObj === null || typeof pObj !== 'object') return;
		let fired;
		if (LUT_A[_trits[pNode.ptr] + Z] === 1) {         // UNION — gate on the trit
			fired = true;
		} else {                                          // CONSENSUS — quorum barrier
			let q = store._quorum.get(parentName);
			if (!q) { q = new Set(); store._quorum.set(parentName, q); }
			q.add(childKey);
			if (q.size >= Object.keys(pObj).filter(kk => kk[0] !== '@').length) { q.clear(); fired = true; }
			else fired = false;
		}
		if (!fired) return;
		trigger(pNode.ptr);                               // fire this parent's subscribers
		name = parentName;                                // and propagate upward
	}
}

function storeWrite(store, key, val) {
	let depthOverride = null;
	if (val !== null && typeof val === 'object' && val[CHIMERA_LAYER] !== undefined) { depthOverride = val[CHIMERA_LAYER]; val = val.value; }
	const ref = store.dict.get(key);
	const node = ref != null ? Signal.deref(ref) : null;
	if (node && _accessorSet.size && _accessorSet.has(node.ptr)) { _accessorSet.get(node.ptr).call(node, val); return node; } // writable-accessor field: dispatch to its setter
	if (node) {
		if (depthOverride !== null) { const cBand = depthOverride >= 3 || depthOverride === Infinity ? 1 : depthOverride === 1 ? -1 : 0; _trits[node.ptr] = _setC(_trits[node.ptr], cBand); }
		const oldV = _values[node.ptr];
		if (is(oldV, val)) { store._proxies.delete(key); return node; }
		_values[node.ptr] = val;
		settleManual(node.ptr, oldV, val);
		reconcileSubtree(store, key, oldV, val);
		store._proxies.delete(key);
		return node;
	}
	const fresh = mintField(val);
	if (depthOverride !== null) { const cBand = depthOverride >= 3 || depthOverride === Infinity ? 1 : depthOverride === 1 ? -1 : 0; _trits[fresh.ptr] = _setC(_trits[fresh.ptr], cBand); }
	if (storeMode(key) === 'deep') _trits[fresh.ptr] = _setA(_trits[fresh.ptr], isUnion(key) ? 1 : -1);
	adopt(_getGlobal().ptr, fresh.ptr);
	store.dict.set(key, fresh.ref);
	store._proxies.delete(key);
	return fresh;
}

function storeRead(store, key) {
	const ref = store.dict.get(key);
	let node = ref != null ? Signal.deref(ref) : null;
	if (!node) node = storeWrite(store, key, undefined);
	const obj = _values[node.ptr];
	if (obj === null || typeof obj !== 'object') return get(node.ptr);
	const mode = storeMode(key);
	if (mode === 'atomic') { track(node.ptr); return obj; }   // ATOMIC: opaque — subscribe to the root, hand back the raw object
	let px = store._proxies.get(key);
	if (!px) { px = storeDescend(store, key, node.ptr, mode, isUnion(key)); store._proxies.set(key, px); }
	if (mode === 'deep') track(node.ptr);
	return px;
}

function storeDescend(store, name, ownerPtr, mode, union) {
	const dict = store.dict;
	const obj = _values[ownerPtr];
	if (obj === null || typeof obj !== 'object') return obj;
	const field = (childName, val, t) => {
		const r = dict.get(childName);
		const n = r != null ? Signal.deref(r) : null;
		if (n) return n;
		let back = val !== null && typeof val === 'object' && val === t ? ownerPtr : null;
		if (back === null && val !== null && typeof val === 'object') {
			let anc = name;
			while (anc) {
				const anRef = dict.get(anc);
				const an = anRef != null ? Signal.deref(anRef) : null;
				if (an && _values[an.ptr] === val) { back = an.ptr; break; }
				const cut = anc.lastIndexOf('.');
				anc = cut > 0 ? anc.slice(0, cut) : '';
			}
		}
		if (back !== null) {
			dict.set(childName, _nodeGen[back] * ID_MULTIPLIER_BIG + BigInt(back));
			return Signal(back);
		}
		const fresh = mintField(val);
		if (mode === 'deep') _trits[fresh.ptr] = _setA(_trits[fresh.ptr], union ? 1 : -1);
		dict.set(childName, fresh.ref);
		adopt(ownerPtr, fresh.ptr);
		return fresh;
	};
	return new Proxy(obj, {
		get(t, k, r) {
			if (typeof k === 'symbol') return Reflect.get(t, k, r);
			const cur = t[k];
			if (typeof cur === 'function') return Reflect.get(t, k, r);
			const childName = name + '.' + k;
			const n = field(childName, cur, t);
			if (mode === 'deep') {
				// subscribe to the deepest node actually reached: descending past this
				// parent moves its edge to the child (retarget — zero alloc/free churn),
				// preserving the prune's watcher-isolation semantics at O(1).
				if (_activePtr !== 0 && LUT_T[_trits[_activePtr] + Z] !== 0) retargetDep(_activePtr, ownerPtr, n.ptr);
				else if (_activePtr !== 0) unsubscribe(_activePtr, ownerPtr);
				else track(n.ptr);
				if (k[0] !== '@' && cur !== null && typeof cur === 'object') {
					if (n.ptr === ownerPtr) return r;   // self-cycle: fold the self-edge onto this proxy
					return storeDescend(store, childName, n.ptr, mode, union);
				}
				return cur;
			}
			track(n.ptr);
			return cur;
		},
		set(t, k, v, r) {
			if (typeof k === 'symbol') { t[k] = v; return true; }
			const prev = t[k];
			if (is(prev, v) && !(k === 'length' && Array.isArray(t))) { t[k] = v; return true; }
			t[k] = v;
			const childName = name + '.' + k;
			const ref = dict.get(childName);
			const n = ref != null ? Signal.deref(ref) : null;
			if (!n) { field(childName, v, t); return true; }
			const oldV = _values[n.ptr];
			_values[n.ptr] = v;
			store._proxies.delete(childName);
			settleManual(n.ptr, oldV, v);
			if (k[0] !== '@') { reconcileSubtree(store, childName, oldV, v); if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName); } // @-shadow: own reference only
			return true;
		},
		deleteProperty(t, k) {
			if (typeof k === 'symbol') return delete t[k];
			const had = k in t;
			const oldV = t[k];
			const ok = delete t[k];
			if (had) {
				const childName = name + '.' + k;
				const r = dict.get(childName);
				const n = r != null ? Signal.deref(r) : null;
				if (n) { _values[n.ptr] = undefined; settleManual(n.ptr, oldV, undefined); if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName); }
			}
			return ok;
		},
		defineProperty(t, k, desc) {
			const ok = Reflect.defineProperty(t, k, desc);
			if (ok && typeof k !== 'symbol' && 'value' in desc) {
				const childName = name + '.' + k;
				const ref = dict.get(childName);
				const n = ref != null ? Signal.deref(ref) : null;
				if (n) { const oldV = _values[n.ptr]; _values[n.ptr] = desc.value; settleManual(n.ptr, oldV, desc.value); }
				else field(childName, desc.value, t);
				if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName);
			}
			return ok;
		},
		has(t, k)  { return k in t; },
		ownKeys(t) { return Reflect.ownKeys(t); },
		getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); }
	});
}

/* kernel weak registry — single mint for the kernel's module tables (core has WEAK).
 * The dynamic per-node weak buckets in the memo cache tree stay structural. */
const KWEAK = { mint(name, kind) { return (KWEAK[name] = kind === 'set' ? new WeakSet() : new WeakMap()); } };
const TRIADS = KWEAK.mint('TRIADS', 'map');   // store → Map(prefix → functor) — identity-stable accessors
function triad(store, prefix, isUnion) {
	let _m = TRIADS.get(store);
	if (!_m) TRIADS.set(store, _m = new Map());
	const _hit = _m.get(prefix);
	if (_hit) return _hit;
	/* The triad contract (0.87.9):
	 *   this.$count      — tracked read/write accessor        (element proxy, unchanged)
	 *   this.$('count')  — UNTRACKED read (peek); two-arg form writes (notifying)
	 *   this.$.count     — the Signal handle itself (get/set/peek/poke + Symbol.toPrimitive)
	 * Function-arg form mints an effect at this triad's grain; object form bulk-writes. */
	const write = (key, val) => storeWrite(store, prefix + key, val);
	const node  = (key) => {                       // handle: minted on miss, NEVER tracks
		const full = prefix + key;
		const ref = store.dict.get(full);
		const n = ref != null ? Signal.deref(ref) : null;
		return n || storeWrite(store, full, undefined);
	};
	const peek  = (key) => {                       // untracked read — the function syntax
		const ref = store.dict.get(prefix + key);
		const n = ref != null ? Signal.deref(ref) : null;
		return n ? rawget(n.ptr) : undefined;
	};
	const depth   = sigilDepth(prefix);                                              // 0 | 1 | Infinity
	const capture = depth === Infinity ? 'deep' : depth === 1 ? 'shallow' : 'atomic';
	const affect  = isUnion ? 'union' : 'consensus';
	const functor = (arg1, arg2) => {
		if (typeof arg1 === 'string') return arg2 === undefined ? peek(arg1) : (write(arg1, arg2), arg2);
		if (typeof arg1 === 'function')
			return new Signal({ value: arg1, options: { capture, affect, effect: arg2 ? 'pull' : 'push' } });
		if (arg1 !== null && typeof arg1 === 'object') {
			const keys = Object.keys(arg1);
			const put = () => { for (const key of keys) write(key.replace(/^[$Δ]+/, ''), arg1[key]); };
			if (isUnion) put(); else Signal.batch(put);
			return store;
		}
		return undefined;
	};
	// ghost function: no own keys (length/name deleted; arrows have no prototype),
	// no inheritance — every string key uniformly resolves to a cell handle, so
	// user keys named toString/name/call/then are reachable and nothing collides.
	Reflect.deleteProperty(functor, 'length');
	Reflect.deleteProperty(functor, 'name');
	Object.setPrototypeOf(functor, null);
	const px = new Proxy(functor, {
		get(f, k) { return k === 'then' ? undefined : typeof k === 'string' ? node(k) : Reflect.get(f, k); }, // then stays reserved: handles are callable, a minted then-handle would satisfy the thenable protocol
		set(_, k, v) { write(k, v); return true; },
	});
	_m.set(prefix, px);
	return px;
}

// ψ — the chainable seeding functor (0.87.a):
//   owner.ψ('$count', 0)('$abc', 1)(() => {})()
//   (key, val)          → write (bare keys default to the $ tier), returns the chain
//   (fn, key?, options?) → effect — shallow by default; options = Signal options API
//                          (explicit null key when only options are given); named
//                          effects park their ref at `${key}$$effect` in the dict
//   ({ bulk })          → batched writes, returns the chain
//   ()                  → unwraps back to the underlying owner (element or store)
const PSI = KWEAK.mint('PSI', 'map');
function psiChain(store, owner) {
	let chain = PSI.get(owner);
	if (chain) return chain;
	const sig = k => /^[$Δ@ø]/.test(k) ? k : '$' + k;
	chain = function ψ(a, b, c) {
		if (arguments.length === 0) return owner;
		if (typeof a === 'function') {
			const opts = (c !== null && typeof c === 'object') ? c : {};
			const capture = opts.capture ?? (opts.deep ? 'deep' : 'shallow');
			const affect  = opts.affect  ?? (opts.union ? 'union' : 'consensus');
			const node = new Signal({ value: a, options: { ...opts, capture, affect } });
			if (typeof b === 'string' && b) store.dict.set(b + '$$effect', node.ref);
			return chain;
		}
		if (typeof a === 'string') { storeWrite(store, sig(a), b); return chain; }
		if (a !== null && typeof a === 'object') {
			Signal.batch(() => { for (const k of Object.keys(a)) storeWrite(store, sig(k), a[k]); });
			return chain;
		}
		return chain;
	};
	PSI.set(owner, chain);
	return chain;
}

// Memoization (APM) — with maxSize and FIFO eviction
const _deepCache = KWEAK.mint('deepCache', 'map');
const _proxySet  = KWEAK.mint('proxySet', 'set');
const _memoGC = (typeof FinalizationRegistry === 'function')
	? new FinalizationRegistry(ref => { const h = Signal.deref(ref); if (h) h.dispose(); })
	: null;

function createDeepProxy(obj, depth, ownerPtr, union) {
	if (obj === null || typeof obj !== 'object' || _proxySet.has(obj) || depth <= 0) return obj;
	const hit = _deepCache.get(obj); if (hit) return hit;
	const changed = union ? null : new Set();
	const proxy = new Proxy(obj, {
		get(t, k, r) {
			if (typeof k === 'symbol') return Reflect.get(t, k, r);
			const cur = t[k];
			if (typeof cur === 'function') return Reflect.get(t, k, r);
			if (ownerPtr) track(ownerPtr);
			return cur !== null && typeof cur === 'object' && depth > 1
				? createDeepProxy(cur, depth === Infinity ? Infinity : depth - 1, ownerPtr, union)
				: cur;
		},
		set(t, k, v) {
			if (typeof k === 'symbol') { t[k] = v; return true; }
			t[k] = v;
			if (ownerPtr) {
				if (union) trigger(ownerPtr);
				else { changed.add(k); if (changed.size >= Object.keys(t).length) { changed.clear(); trigger(ownerPtr); } }
			}
			return true;
		},
	});
	_deepCache.set(obj, proxy); _proxySet.add(proxy);
	return proxy;
}

function trieNode(parent = null, key = null, bucket = null) { 
    return { children: null, weak: null, node: null, val: undefined, parent, key, bucket, refs: 0 }; 
}

function trieDescend(root, args) {
    let cur = root;
    for (let i = 0; i < args.length; i++) {
        cur.refs++;                         // this path is now used by one more leaf
        const arg = args[i];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && arg !== null && (typeof arg === 'object' || typeof arg === 'function');
        const key   = isSig ? arg.ref : arg;
        const bucket = weak ? (cur.weak || (cur.weak = new WeakMap())) : (cur.children || (cur.children = new Map()));
        
        if (!bucket.has(key)) {
            bucket.set(key, trieNode(cur, key, bucket));
        }
        cur = bucket.get(key);
    }
    cur.refs++;                             // the leaf itself counts as one reference
    return cur;
}

// Non-mutating descent: walk existing buckets only — no creation, no ref counting.
function triePeek(root, args) {
    let cur = root;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && arg !== null && (typeof arg === 'object' || typeof arg === 'function');
        const key   = isSig ? arg.ref : arg;
        const bucket = weak ? cur.weak : cur.children;
        if (!bucket || !bucket.has(key)) return null;
        cur = bucket.get(key);
    }
    return cur;
}

// Detach a leaf from the trie: clear payload, walk up decrementing refs, prune dead branches.
// (Extracted from the eviction path so delete()/stale-rebuild share the exact invariant.)
function triePrune(leaf) {
    leaf.node = null; leaf.val = undefined;
    let curr = leaf;
    while (curr && curr.parent) {
        curr.refs--;
        if (curr.refs === 0) {
            curr.bucket.delete(curr.key);
            if (curr.bucket instanceof Map && curr.bucket.size === 0) curr.parent.children = null;
        }
        curr = curr.parent;
    }
    if (curr) curr.refs--;
}

/**
 * Wraps a function in an Autonomous Parameterized Memoization (APM) trie.
 * Each unique argument signature generates its own distinct, reactive arena node (leaf).
 * * @param {Function} fn - The computation or effect to memoize.
 * @param {Object} [opts={}] - Configuration options (union, deep, effect, maxSize).
 * @returns {Function} A memoized proxy function that tracks arguments and caches results.
 * * @internal
 * MEMORY PRUNING INVARIANT (V17):
 * We maintain a strict FIFO eviction policy capped at `maxSize` (default 10,000) 
 * to prevent arena OOM. Because arguments are mapped into a nested Trie of `Map` 
 * and `WeakMap` buckets, evicting the leaf's signal is not enough—the parent Maps 
 * would accumulate primitive keys forever, causing a severe structural memory leak.
 * * To fix this, `trieNode` implements bottom-up reference counting (`refs`). 
 * When a leaf is evicted, we walk up the `parent` chain, decrementing `refs`. 
 * If a branch hits 0, we surgically `delete` its key from the parent's bucket, 
 * collapsing dead branches and completely eliminating the leak.
 */
function memo(fn, opts = {}) {
    const union = !!opts.union, deep = opts.deep ? Infinity : 0, isEffect = !!opts.effect;
    const maxSize = opts.maxSize ?? 10000;
    // key strategy: 'args' (default) = trie over the argument tuple; a function derives
    // a custom signature — cache keyed by opts.key(...args), factory still gets real args.
    const sigOf = typeof opts.key === 'function' ? (args) => [opts.key.apply(null, args)] : (args) => args;
    let live = 0;                                   // live leaf count — the management-API size
    const host = allocNode();
    _trits[host] = TRIT_STATE;
    _ctx[host] = trieNode();
    adopt(_getGlobal().ptr, host);
    const dropFromQueue = (ptr) => {
        const q = _ctx[host].leafQueue;
        if (!q) return;
        const i = q.findIndex(e => e.ptr === ptr);
        if (i >= 0) q.splice(i, 1);
    };

    const leafTrit = isEffect
        ? encodeTrit(-1,  1, union ? 1 : -1, deep ? 1 : 0, -1)
        : encodeTrit( 1, -1, union ? 1 : -1, deep ? 1 : 0, -1);

    const memoized = function memoized(...args) {
        const leaf = trieDescend(_ctx[host], sigOf(args));
        const cached = leaf.node;
        
        // Cache Hit: Re-track or eagerly dispose if generator gen-tags mismatch
        if (cached && _nodeGen[cached.ptr] === cached.gen) {
            if (isEffect) return undefined;
            if (_trits[cached.ptr] > 40) { track(cached.ptr); return leaf.val; }
            dropFromQueue(cached.ptr); live--;      // stale — this leaf is being rebuilt
            tagForDisposal(cached.ptr); sweep();
        }

        // Cache Miss: Allocate a new reactive node for this argument signature
        const leafPtr = allocNode();
        _trits[leafPtr] = leafTrit;
        adopt(host, leafPtr);
        const leafRef = _nodeGen[leafPtr] * ID_MULTIPLIER_BIG + BigInt(leafPtr);
        
        // Register objects with the GC to auto-dispose reactive nodes when args die
        if (_memoGC) {
            for (const a of args) {
                if (a !== null && (typeof a === 'object' || typeof a === 'function') && !(a instanceof Signal))
                    _memoGC.register(a, leafRef);
            }
        }

        // Register the new leaf in the eviction queue
        const leafQueue = _ctx[host].leafQueue || (_ctx[host].leafQueue = []);
        leafQueue.push({ ptr: leafPtr, trieNode: leaf });
        live++;

        // FIFO EVICTION & TRIE PRUNING
        if (leafQueue.length > maxSize) {
            const old = leafQueue.shift();
            if (old && old.trieNode && old.trieNode.node && old.trieNode.node.ptr === old.ptr) {
                triePrune(old.trieNode);            // detach from the trie (extracted invariant)
            }
            
            // Dispose the arena node to free the actual memory
            if (old && _trits[old.ptr] !== 0) { tagForDisposal(old.ptr); sweep(); live--; }
        }

        // Execute and bind result to the leaf node
        if (isEffect) {
            _values[leafPtr] = () => fn.apply(this, args);
            _ctx[leafPtr] = { _chimeraFn: _values[leafPtr] };
            leaf.node = Signal(leafPtr);
            leaf.val = undefined;
            runNode(leafPtr);
            return undefined;
        } else {
            const prev = _activePtr; _activePtr = leafPtr; _traceEpoch++;
            let result;
            try { result = fn.apply(this, args); }
            catch (e) { 
                console.error('[Chimera V17] memo error:', e); 
                _trits[leafPtr] = QUARANTINE; 
                _activePtr = prev; 
                return undefined; 
            }
            _activePtr = prev;
            
            const out = deep ? createDeepProxy(result, deep, leafPtr, union) : result;
            leaf.node = Signal(leafPtr);
            leaf.val = out;
            track(leafPtr);
            return out;
        }
    };

    // ── per-signature management API (0.87.8) — the unified-Store contract ──
    const liveLeaf = (leaf) => !!(leaf && leaf.node
        && _nodeGen[leaf.node.ptr] === leaf.node.gen && _trits[leaf.node.ptr] > 40);

    memoized.has = (...args) => liveLeaf(triePeek(_ctx[host], sigOf(args)));

    memoized.delete = (...args) => {
        const leaf = triePeek(_ctx[host], sigOf(args));
        if (!leaf || !leaf.node) return false;
        const ptr = leaf.node.ptr, gen = leaf.node.gen;
        dropFromQueue(ptr);
        triePrune(leaf);
        if (_nodeGen[ptr] === gen && _trits[ptr] !== 0) { tagForDisposal(ptr); sweep(); }
        live--;
        return true;
    };

    memoized.clear = () => {
        const q = _ctx[host].leafQueue || [];
        for (const e of q) if (_trits[e.ptr] !== 0) { tagForDisposal(e.ptr); }
        if (q.length) sweep();
        _ctx[host] = trieNode();
        live = 0;
    };

    Object.defineProperty(memoized, 'size', { get: () => live });

    return memoized;
}


Signal.memo = memo;

// Reactive class scanner (unchanged except uses get() for computed members)
function memberTrit(R, E, union, deep) { return encodeTrit(R, E, union ? 1 : -1, deep ? 1 : -1, -1); }

function scanClass(instance, store, activeEffects, members) {
	const enginePtr = store.engine.ptr;
	const seen = new Set(['constructor']);
	let proto = Object.getPrototypeOf(instance);
	while (proto && proto !== Signal.prototype && proto !== Object.prototype && proto !== Function.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (seen.has(key)) continue;
			seen.add(key);
			const sfx = SUFFIX_RE.exec(key);
			if (sfx && sfx[1] !== '') {
				const desc = Object.getOwnPropertyDescriptor(proto, key);
				if (desc && (typeof desc.value === 'function' || typeof desc.get === 'function')) {
					const sig = sfx[2];
					activeEffects.push({ key, name: sfx[1], method: desc.value || desc.get, deep: sig.length >= 3, union: isUnion(sig) });
				}
				continue;
			}
			const pfx = PREFIX_RE.exec(key);
			if (!pfx) continue;
			const sig = pfx[1], depth = sigilDepth(key), deep = depth === Infinity, union = isUnion(sig);
			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (!desc) continue;
			const isGetter = typeof desc.get === 'function', isMethod = typeof desc.value === 'function';
			if (!isGetter && !isMethod) continue;
			const trit = memberTrit(1, -1, union, deep);
			const ptr = allocNode();
			_trits[ptr] = trit;

			if (isGetter) {
				_values[ptr] = desc.get;                     // function
				_ctx[ptr] = undefined;                       // cached result goes here
				adopt(enginePtr, ptr);
				Object.defineProperty(instance, key, {
					configurable: true, enumerable: true,
					get: function () {
						const val = get(ptr);
						return depth > 0 ? createDeepProxy(val, depth, ptr, union) : val;
					}
				});
			} else {
				adopt(enginePtr, ptr);
				Object.defineProperty(instance, key, {
					configurable: true, enumerable: true, writable: true,
					value: memo(desc.value, { union, deep })
				});
			}
			members.add(key);
			store.dict.set(key, _nodeGen[ptr] * ID_MULTIPLIER_BIG + BigInt(ptr));
		}
		proto = Object.getPrototypeOf(proto);
	}
}

function registerActiveEffects(proxy, store, effects) {
	for (const { key, method, deep, union } of effects) {
		const c = new Signal.Effect(method.bind(proxy), { _trit: memberTrit(-1, 1, union, deep) });
		adopt(store.engine.ptr, c.ptr);
		store.dict.set(key, c.ref);
	}
}

Signal.reactive = reactive;
Signal.layer    = layer;

// ── Boot ──
init(SIZES.L2);

const API = { Signal, Substrate, reactive, layer, getEngine, REACTIVE_STORE, CHIMERA_LAYER };
try {
	return Object.defineProperty(globalThis, CHIMERA, {
		value: () => API,
		writable: false, enumerable: false, configurable: false
	})[CHIMERA]();
} catch (e) {
	return API;
}

});

/* ===== Compiler v7.1.1 ===== */
// Compiler.js — v7.1.1 transpiler, extracted from the Instance monolith's EXTMAP.COMPILER method.
const COMPILER_FACTORY = function (global, deps, version = '7.1.1') {
		const INSTANCE = "Symbol.for('Instance')";
		const USING = "Symbol.for('Instance/using')";

		/* ── literal scanners — find each literal's END, keep it opaque ── */
		function scanStr(s, i) {
			const q = s[i];
			i++;
			while (i < s.length) {
				const c = s[i];
				if (c === '\\') {
					i += 2;
					continue;
				}
				if (c === q) return i + 1;
				i++;
			}
			return i;
		}
		function scanTpl(s, i) {
			i++;
			while (i < s.length) {
				const c = s[i];
				if (c === '\\') {
					i += 2;
					continue;
				}
				if (c === '`') return i + 1;
				if (c === '$' && s[i + 1] === '{') i = scanBraces(s, i + 2);
				else i++;
			}
			return i;
		}
		function scanBraces(s, i) {
			let d = 1;
			while (i < s.length && d > 0) {
				const c = s[i];
				if (c === '\\') {
					i += 2;
					continue;
				}
				if (c === '{') {
					d++;
					i++;
				} else if (c === '}') {
					d--;
					i++;
				} else if (c === '`') i = scanTpl(s, i);
				else if (c === '"' || c === "'") i = scanStr(s, i);
				else if (c === '/' && s[i + 1] === '/') {
					while (i < s.length && s[i] !== '\n') i++;
				} else if (c === '/' && s[i + 1] === '*') {
					i += 2;
					while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
					i += 2;
				} else i++;
			}
			return i;
		}
		function scanRe(s, i) {
			i++;
			let cls = false;
			while (i < s.length) {
				const c = s[i];
				if (c === '\\') {
					i += 2;
					continue;
				}
				if (c === '[') cls = true;
				else if (c === ']') cls = false;
				else if (c === '/' && !cls) {
					i++;
					while (i < s.length && /[a-z]/i.test(s[i])) i++;
					return i;
				}
				i++;
			}
			return i;
		}


		const RE_PREV = new Set([
			'=', '+', '-', '*', '/', '%', '(', '[', '{', '&', '|', '^', '~', '<', '>',
			'!', '?', ':', ',', ';', '=>', '&&', '||', '??', '==', '===', '!=', '!==',
			'return', 'typeof', 'case', 'do', 'delete', 'void', 'in', 'instanceof',
			'new', 'yield', 'await', 'throw'
		]);

		function lex(src) {
			const T = [];
			const n = src.length;
			let i = 0;
			let	prev = null;
			const op2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '+=', '-=', '*=', '/=', '**', '?.'];
			const op3 = ['===', '!==', '**=', '...'];
			while (i < n) {
				const c = src[i],
					s = i;
				if (/\s/.test(c)) {
					while (i < n && /\s/.test(src[i])) i++;
					T.push({ t: 'ws', s, e: i, v: src.slice(s, i) });
					continue;
				}
				if (c === '/' && src[i + 1] === '/') {
					while (i < n && src[i] !== '\n') i++;
					T.push({ t: 'cm', s, e: i, v: src.slice(s, i) });
					continue;
				}
				if (c === '/' && src[i + 1] === '*') {
					i += 2;
					while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
					i += 2;
					T.push({ t: 'cm', s, e: i, v: src.slice(s, i) });
					continue;
				}
				if (c === '"' || c === "'") {
					i = scanStr(src, i);
					T.push({ t: 'str', s, e: i, v: src.slice(s, i) });
					prev = 'str';
					continue;
				}
				if (c === '`') {
					i = scanTpl(src, i);
					T.push({ t: 'str', s, e: i, v: src.slice(s, i) });
					prev = 'str';
					continue;
				}
				if (c === '/') {
					if (!prev || RE_PREV.has(prev)) {
						i = scanRe(src, i);
						T.push({ t: 're', s, e: i, v: src.slice(s, i) });
						prev = 're';
						continue;
					}
				}
				if (/[A-Za-z_$#Δø]/.test(c)) {
					i++;
					while (i < n && /[\w$Δø]/.test(src[i])) i++;
					const w = src.slice(s, i);
					T.push({ t: 'id', s, e: i, v: w });
					prev = w;
					continue;
				}
				if (/[0-9]/.test(c)) {
					i++;
					while (i < n && /[\w.]/.test(src[i])) i++;
					T.push({ t: 'num', s, e: i, v: src.slice(s, i) });
					prev = 'num';
					continue;
				}
				let p = c;
				const a3 = src.slice(i, i + 3),
					a2 = src.slice(i, i + 2);
				if (op3.includes(a3)) p = a3;
				else if (op2.includes(a2)) p = a2;
				i += p.length;
				T.push({ t: 'pu', s, e: i, v: p });
				prev = p;
				continue;
			}
			return T;
		}
		const sig = (T, i, d) => {
			let j = i + d;
			while (j >= 0 && j < T.length && (T[j].t === 'ws' || T[j].t === 'cm')) j += d;
			return j;
		};
		const CONT_PREV = new Set([
			'=', '+', '-', '*', '/', '%', '&', '|', '^',
			'~', '<', '>', '!', '?', ':', ',', '.', '(',
			'[', '{', '=>', '&&', '||', '??', '**', '?.'
		]);
		const CONT_KW = new Set([
			'new', 'typeof', 'void', 'delete', 'await', 'yield',
			'in', 'instanceof', 'return', 'throw', 'case', 'of', 
			'extends'
		]);
		function isCont(p, nx) {
			if (
				p &&
				((p.t === 'pu' && CONT_PREV.has(p.v)) || (p.t === 'id' && CONT_KW.has(p.v)))
			)
				return true;
			if (nx) {
				if (nx.t === 'pu' && ![')', ']', '}', ';', '@'].includes(nx.v)) return true;
				if (nx.t === 'id' && (nx.v === 'in' || nx.v === 'instanceof')) return true;
				if (nx.t === 'str' && nx.v[0] === '`') return true;
			}
			return false;
		}

		function findClasses(T) {
			const cs = [];
			for (let i = 0; i < T.length; i++) {
				if (T[i].t === 'id' && T[i].v === 'class') {
					// head markers BEFORE class (async / mixed / iterable)
					let hj = sig(T, i, -1);
					const head = [];
					while (hj >= 0) {
						const t = T[hj];
						if (t.t === 'ws' || t.t === 'cm') {
							hj--;
							continue;
						}
						if (
							t.t === 'id' &&
							['sync', 'async', 'mixed', 'iterable'].includes(t.v)
						) {
							head.unshift(t.v);
							hj--;
						} else break;
					}
					let kwStart = T[i].s;
					if (head.length) {
						let k = i - 1,
							c = head.length;
						while (k >= 0 && c) {
							if (
								T[k].t === 'id' &&
								['sync', 'async', 'mixed', 'iterable'].includes(T[k].v)
							)
								c--;
							k--;
						}
						kwStart = T[k + 1].s;
					}
					// star suffix AFTER the class keyword:  `class*`  ≡  `iterable class`  (composes with async/mixed)
					let nameJ = sig(T, i, 1);
					if (T[nameJ] && T[nameJ].t === 'pu' && T[nameJ].v === '*') {
						if (!head.includes('iterable')) head.push('iterable');
						nameJ = sig(T, nameJ, 1);
					}
					const name = T[nameJ] ? T[nameJ].v : null;
					let ej = sig(T, nameJ, 1),
						ext = null;
					if (T[ej] && T[ej].v === 'extends') {
						ext = T[sig(T, ej, 1)].v;
					}
					let j = nameJ;
					while (j < T.length && !(T[j].t === 'pu' && T[j].v === '{')) j++;
					let d = 0,
						k = j;
					for (; k < T.length; k++) {
						const t = T[k];
						if (t.t === 'pu') {
							if (t.v === '{') d++;
							else if (t.v === '}') {
								d--;
								if (d === 0) break;
							}
						}
					}
					cs.push({ name, ext, head, kwStart, open: j, close: k, classKw: i });
					i = k;
				}
			}
			return cs;
		}

		/* cut a class body into member char-spans (the one job regex can't do) */
		function splitMembers(T, open, close) {
			const out = [];
			let depth = 0,
				mode = null;
			let start = sig(T, open, 1);
			if (start < 0 || start >= close) return out;
			const emit = endIdx => {
				const a = T[start],
					b = T[endIdx];
				if (a && b && b.e > a.s) out.push([a.s, b.e]);
			};
			for (let i = start; i < close; i++) {
				const t = T[i];
				if (t.t === 'ws' || t.t === 'cm') {
					if (depth === 0 && mode === 'field' && t.v.includes('\n')) {
						const pj = sig(T, i, -1),
							nj = sig(T, i, 1);
						if (pj >= start && nj < close && !isCont(T[pj], T[nj])) {
							emit(pj);
							start = nj;
							mode = null;
						}
					}
					continue;
				}
				if (t.t === 'pu') {
					if (depth === 0 && mode === null && t.v === '(') mode = 'method';
					if (depth === 0 && mode === null && t.v === '=') mode = 'field';
					if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
					else if (t.v === ')' || t.v === ']' || t.v === '}') {
						depth--;
						if (depth === 0 && t.v === '}' && mode === 'method') {
							emit(i);
							start = sig(T, i, 1);
							mode = null;
						}
					} else if (depth === 0 && t.v === ';') {
						const pj = sig(T, i, -1);
						emit(pj >= start ? pj : i);
						start = sig(T, i, 1);
						mode = null;
					}
				}
			}
			if (start >= 0 && start < close) {
				const pj = sig(T, close, -1);
				if (pj >= start) emit(pj);
			}
			return out;
		}

		/* ═══ THE REGEX RULE TABLE — pure string manipulation per slice ════════════════
Leading-anchored regexes; RHS captured as an opaque blob. Order matters
(first match wins). $1,$2,… in `emit` are the regex capture groups. */
		const ID = `[$Δ@ø]{0,3}[A-Za-z_][\\w$]*`;
		const RULES = [
			/* ── the two you sketched, first ── */
			// await $x = y          →  spine:  this.$x = await y;
			{
				scope: 'instance-field',
				match: new RegExp(`^await\\s+(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'spine',
				emit: 'this.$1 = await $2;'
			},
			// x[] = await for y      →  spine:  this.x = []; for await (const __v of y) this.x.push(__v);
			{
				scope: 'instance-field',
				match: new RegExp(
					`^(${ID})\\s*\\[\\s*\\]\\s*=\\s*await\\s+for\\s+([\\s\\S]+)$`
				),
				slot: 'spine',
				emit: 'this.$1 = []; for await (const __v of $2) this.$1.push(__v);'
			},

			/* ── room to grow (already wired; add rows freely) ── */
			// async $x = await y     →  fan
			{
				scope: 'instance-field',
				match: new RegExp(`^async\\s+(${ID})\\s*=\\s*(?:await\\s+)?([\\s\\S]+)$`),
				slot: 'fan',
				emit: 'Promise.resolve($2).then(__v => { this.$1 = __v; });'
			},
			// defer $x = y           →  join (hook tail)
			{
				scope: 'instance-field',
				match: new RegExp(`^defer\\s+(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'join',
				emit: 'this.$1 = $2;'
			},
			// x[] = sync y           →  spine (eager spread)
			{
				scope: 'instance-field',
				match: new RegExp(`^(${ID})\\s*\\[\\s*\\]\\s*=\\s*sync\\s+([\\s\\S]+)$`),
				slot: 'spine',
				emit: 'this.$1 = [...$2];'
			},
			// x[] = async y          →  fan (growing)
			{
				scope: 'instance-field',
				match: new RegExp(`^(${ID})\\s*\\[\\s*\\]\\s*=\\s*async\\s+([\\s\\S]+)$`),
				slot: 'fan',
				emit: 'this.$1 = []; (async () => { for await (const __v of $2) this.$1.push(__v); })();'
			}, // convert __v to an expando increment _instance++
			// using $x = r           →  spine + dispose registration
			{
				scope: 'instance-field',
				match: new RegExp(`^using\\s+(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'spine',
				emit: `this.$1 = $2; this[${USING}](this.$1, false);`
			},
			// await using $x = r     →  spine + asyncDispose
			{
				scope: 'instance-field',
				match: new RegExp(`^await\\s+using\\s+(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'spine',
				emit: `this.$1 = $2; this[${USING}](this.$1, true);`
			},
			// $x = await y           →  spine
			{
				scope: 'instance-field',
				match: new RegExp(`^(${ID})\\s*=\\s*await\\s+([\\s\\S]+)$`),
				slot: 'spine',
				emit: 'this.$1 = await $2;'
			},
			// $x = y  (scalar)       →  spine
			{
				scope: 'instance-field',
				match: new RegExp(`^(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'spine',
				emit: 'this.$1 = $2;'
			},

			/* ── static mirror: `static` is itself a left modifier, so await/await-for stack on the left
				*    (canonical), routed to the static hook. Same shapes as the instance spine/drain/scalar.
				*    scopeOf() has already stripped the leading `static`, so these match the bare body. ── */
			// static await $c = y       →  static spine (gates static settlement)
			{
				scope: 'static-field',
				match: new RegExp(`^await\\s+(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'static',
				emit: 'this.$1 = await $2;'
			},
			// static c[] = await for y   →  static drain (gates)
			{
				scope: 'static-field',
				match: new RegExp(
					`^(${ID})\\s*\\[\\s*\\]\\s*=\\s*await\\s+for\\s+([\\s\\S]+)$`
				),
				slot: 'static',
				emit: 'this.$1 = []; for await (const __v of $2) this.$1.push(__v);'
			},
			// static $c = await y        →  RHS spine (lenient; the left-modifier form is canonical)
			{
				scope: 'static-field',
				match: new RegExp(`^(${ID})\\s*=\\s*await\\s+([\\s\\S]+)$`),
				slot: 'static',
				emit: 'this.$1 = await $2;'
			},
			// static $c = y              →  static scalar (eager prefix)
			{
				scope: 'static-field',
				match: new RegExp(`^(${ID})\\s*=\\s*([\\s\\S]+)$`),
				slot: 'static',
				emit: 'this.$1 = $2;'
			},

			/* ── members kept in place ── */
			// async get $x() {...}   →  sync getter returning an async IIFE (STRUCTURAL — escape hatch).
			//   works for `static async get` too: the leading `static` is carried through (it's a proto/static
			//   accessor either way, never a settled field, so it stays in place rather than joining the hook).
			{
				scope: 'accessor',
				match: /^async\s+get\b/,
				slot: 'keep',
				emit: (caps, slice) => {
					const stat = /^\s*static\b/.test(slice) ? 'static ' : '';
					const m = slice.match(
						/get\s+([A-Za-z0-9_$]+)\s*\(\s*\)\s*\{([\s\S]*)\}\s*$/
					);
					return m
						? `${stat}get ${m[1]}() { return (async () => { ${m[2].trim()} })(); }`
						: slice.replace(/\basync\s+get\b/, 'get');
				}
			},
			{ scope: 'accessor', match: /^/, slot: 'keep', emit: (c, slice) => slice },
			{ scope: 'method', match: /^/, slot: 'keep', emit: (c, slice) => slice }
		];

		/* scope of a slice (regex on the clean slice) */
		function scopeOf(slice) {
			const s = slice.trim();
			let body = s,
				isStatic = false;
			if (/^static\b/.test(body)) {
				isStatic = true;
				body = body.replace(/^static\s+/, '');
			}
			const eq = indexOfTop(body, '='),
				lp = indexOfTop(body, '(');
			const callable = lp !== -1 && (eq === -1 || lp < eq);
			if (callable) {
				// strip grain markers (sync/mixed/async/iterable) that may lead a constructor/method
				const bare = body.replace(/^(?:mixed\s+|iterable\s+|async\s+|sync\s+)+/, '');
				if (/^constructor\b/.test(bare)) return { scope: 'ctor', body };
				if (/^(?:async\s+|static\s+)*(?:get|set)\b/.test(body))
					return { scope: 'accessor', body, isStatic };
				return { scope: 'method', body, isStatic };
			}
			return { scope: isStatic ? 'static-field' : 'instance-field', body, isStatic };
		}
		/* index of a char at the top level of a slice (literals already won't contain class-level punct,
but RHS object/paren nesting can — so do a shallow depth scan via the lexer) */
		function indexOfTop(s, ch) {
			const T = lex(s);
			let d = 0;
			for (const t of T) {
				if (t.t === 'pu') {
					if (d === 0 && t.v === ch) return t.s;
					if ('([{'.includes(t.v)) d++;
					else if (')]}'.includes(t.v)) d--;
				}
			}
			return -1;
		}

		const interp = (t, m) => t.replace(/\$(\d)/g, (_, k) => m[+k] ?? '');
		function fire(matchText, scope, rawSlice) {
			for (const r of RULES) {
				if (r.scope !== scope) continue;
				const m = r.match.exec(matchText);
				if (!m) continue;
				const code =
					typeof r.emit === 'function' ? r.emit(m, rawSlice) : interp(r.emit, m);
				return {
					slot: r.slot,
					code,
					manifest: m[1] && /^[$Δ]/.test(m[1]) ? m[1] : null
				};
			}
			return { slot: 'keep', code: rawSlice, manifest: null };
		}

		/* find the balanced super(...) call in a constructor body (parens balanced, so super(foo()) is intact) */
		function extractSuper(inner) {
			const m = inner.match(/((?:await|yield)\s+)?\bsuper\b\s*\(/);
			if (!m) return null;
			const kw = (m[1] || '').trim(); // '', 'await', or 'yield'
			const form = kw === 'await' ? 'await' : kw === 'yield' ? 'yield' : 'plain';
			const op = m.index + m[0].length - 1;
			let d = 1,
				i = op + 1;
			for (; i < inner.length; i++) {
				const c = inner[i];
				if (c === '(') d++;
				else if (c === ')') {
					d--;
					if (!d) break;
				}
			}
			const args = inner.slice(op + 1, i).trim();
			let end = i + 1;
			while (end < inner.length && /\s/.test(inner[end])) end++;
			if (inner[end] === ';') end++;
			return { form, args, callStart: m.index, callEnd: end };
		}

		/* ═══ ASSEMBLY ════════════════════════════════════════════════════════════════ */

		/* Scan ONLY the constructor's own async frame for `await`. Awaits inside a NESTED
			* function (arrow body, function expr — braced or braceless) belong to that function
			* and don't count; awaits inside blocks / loops / ifs share the constructor's frame
			* and DO count. `await super()` counts too. Used to enforce R9 (procedural await must
			* declare async/mixed) — the one piece that needs async-frame tracking, not just braces. */
		function hasTopLevelAwait(src) {
			const T = lex(src);
			const braces = []; // stack of '{' kinds: 'fn' (function body) | 'block'
			const arrows = []; // paren-depths at which a BRACELESS arrow body is open
			let pd = 0,
				pendFn = false,
				pendFnPd = 0;
			for (let i = 0; i < T.length; i++) {
				const t = T[i];
				if (t.t === 'ws' || t.t === 'cm') continue;
				const inFn = braces.includes('fn') || arrows.length > 0;
				if (t.t === 'id') {
					if (t.v === 'await' && !inFn) return true; // top-level await in the ctor frame
					if (t.v === 'function') {
						pendFn = true;
						pendFnPd = pd;
					}
					continue;
				}
				if (t.t !== 'pu') continue;
				switch (t.v) {
					case '(':
						pd++;
						break;
					case ')':
						while (arrows.length && arrows[arrows.length - 1] >= pd) arrows.pop();
						pd--;
						break;
					case ',':
						while (arrows.length && arrows[arrows.length - 1] >= pd) arrows.pop();
						break;
					case ';':
						arrows.length = 0;
						break;
					case '=>': {
						const nx = T[sig(T, i, 1)];
						if (!(nx && nx.t === 'pu' && nx.v === '{')) arrows.push(pd);
						break;
					}
					case '{': {
						const pv = T[sig(T, i, -1)];
						const isFn =
							(pv && pv.t === 'pu' && pv.v === '=>') ||
							(pendFn && pd === pendFnPd);
						braces.push(isFn ? 'fn' : 'block');
						if (isFn) pendFn = false;
						break;
					}
					case '}':
						braces.pop();
						break;
				}
			}
			return false;
		}

		/* ─ GRAIN, the new two-read model ────────────────────────────────────────────────────────────────
			*  A grain is an AWAIT POLICY at a boundary: sync = no await · mixed = await OPTIONAL · async = await
			*  MANDATORY. It is read at TWO independent sites, and they mean different things:
			*    · CLASS grain  (head marker) = the CONSUMER's await-new obligation. sync→`new X()` is ready ·
			*      mixed→`new` snapshot OR `await new` settled (consumer's choice) · async→MUST `await new`.
			*    · CTOR  grain  (constructor marker) = the chain link / super-form. sync→`super()` is the CAP
			*      (stops the chain) · mixed→`yield super()` FORWARDS (chains iff the consumer awaited) · async→
			*      `await super()` TAKES (always chains). The two grains are coupled by Rule 1; the super-form is
			*      mandated by the ctor grain; the cap may sit only on a sync parent (Rule 2). See the RULES block. */
		/* CLASS grain of a class = its consumer await-new obligation, from the CLASS HEAD marker:
			* 'sync' (unmarked) | 'mixed' | 'async'. Rule 2 (the cap rule) keys on this for a locally-declared
			* parent — a [sync] cap may extend only a 'sync' parent. (The CONSTRUCTOR's own grain is read
			* separately, in emitClass, from the constructor marker.) */
		function headGrain(cls) {
			const ch = cls.head.join(' ');
			return /\bmixed\b/.test(ch) ? 'mixed' : /\basync\b/.test(ch) ? 'async' : 'sync';
		}

		function emitClass(T, src, cls, diags, grainOf = {}, opts = {}) {
			const spans = splitMembers(T, cls.open, cls.close);
			const fields = []; // instance fields, IN SOURCE ORDER: {code, blocking, defer}
			const staticFields = []; // static fields, IN SOURCE ORDER: {code, blocking}
			const keep = [];
			const manifest = [],
				staticManifest = [];
			let ctor = null; // reactive ($) names, instance vs static, kept apart

			for (const [a, b] of spans) {
				const slice = src.slice(a, b).trim();
				const { scope, body } = scopeOf(slice);
				if (scope === 'ctor') {
					ctor = slice;
					continue;
				}
				const e = fire(body, scope, slice);
				if (e.slot === 'keep') keep.push(e.code);
				else if (e.slot === 'static') {
					// no static fan / async-fold rules exist, so a bare `await` in the emitted line is a reliable
					// GATE marker (spine-await or await-for) — nothing buries await inside an IIFE at this level.
					staticFields.push({ code: e.code, blocking: /\bawait\b/.test(e.code) });
					if (e.manifest) staticManifest.push(e.manifest);
				} else {
					fields.push({
						code: e.code,
						blocking: e.slot === 'spine' && /\bawait\b/.test(e.code), // spine-await or await-for: GATES
						defer: e.slot === 'join'
					}); // runs at the tail, after settle
					if (e.manifest) manifest.push(e.manifest);
				}
			}

			const blockIdx = fields.findIndex(f => f.blocking); // first ASYNC_BLOCKING field (spine-await / await-for)
			const staticBlockIdx = staticFields.findIndex(f => f.blocking); // first blocking static (gates static settlement)
			const statAwait = staticBlockIdx !== -1; // class-level blocking async (a static field that gates)
			const classGrainHead = headGrain(cls); // 'sync' | 'mixed' | 'async' — the CONSUMER obligation
			const classAsync = classGrainHead !== 'sync';

			/* R10 (class level): a static field's `await` (LHS and RHS) is class-level blocking async → the class MUST
				* be declared `async class` or `mixed class`. Missing it is a hard SyntaxError (no auto-correct). */
			if (statAwait && !classAsync)
				throw new SyntaxError(
					`Instance: class ${cls.name} — a static field uses 'await' (class-level blocking async); '${cls.name}' must be declared 'async class' or 'mixed class'.`
				);

			/* ── constructor analysis: the CTOR grain (chain link / super-form) and the super-form it carries.
				*  The ctor grain defaults to 'sync' when unmarked. A synthesized (omitted) constructor INHERITS the
				*  CLASS grain, so an `async class` with no constructor still gets an `await super()` take-chain. ── */
			let params = '...args',
				superArgs = '...args',
				pre = '',
				tail = '',
				superForm = 'plain',
				ctorGrain = 'sync',
				ctorBodyAwait = false,
				hasSuper = false;
			if (ctor) {
				const mh = ctor.match(
					/^([\s\S]*?)\bconstructor\s*\(([\s\S]*?)\)\s*\{([\s\S]*)\}\s*$/
				);
				if (mh) {
					const mk = mh[1].match(/\b(sync|async|mixed)\b/);
					ctorGrain = mk ? mk[1] : 'sync';
					params = mh[2].trim();
					const inner = mh[3];
					ctorBodyAwait = hasTopLevelAwait(inner); // a top-level `await` in the BODY
					const s = extractSuper(inner);
					if (s) {
						hasSuper = true;
						superForm = s.form;
						superArgs = s.args;
						pre = inner.slice(0, s.callStart).trim();
						tail = inner.slice(s.callEnd).trim();
					} else {
						tail = inner.trim();
					}
				}
			} else {
				ctorGrain = classGrainHead;
				hasSuper = true; // synthesized → inherits the class grain
				superForm =
					ctorGrain === 'async' ? 'await' : ctorGrain === 'mixed' ? 'yield' : 'plain';
			}
			// DEBUG nudge: a manual ctor that declares params but forwards NONE to super() drops arguments a
			// parameterized Instance parent may need. The user's super() is respected exactly as written —
			// partial forwards (super(a) for (a, b)) never trip this, and synthesized ctors forward ...args.
			if (ctor && hasSuper && params.trim() && !superArgs.trim())
				diags.push({
					level: 'warn',
					message: `class ${cls.name}: constructor(${params}) calls super() without forwarding arguments — a parameterized Instance parent won't receive them. Forward with super(...args) (or super(${params})), or omit the constructor.`
				});
			const art = g => (g === 'async' ? 'an' : 'a'); // grammatical article for diagnostics

			/* ── R10 (instance level): a blocking INSTANCE field is a pending (`??`) field at `new`, so the
				*    CLASS must be 'mixed' or 'async' (field grain ⟹ class grain). A 'sync class' is fully ready at
				*    `new` and cannot present a pending field. NOTE this constrains the CLASS, not the constructor —
				*    a sync (cap) constructor over a sync parent is fine even with a blocking field: the field
				*    settles in the settlement fn without a parent chain. The constructor grain is the chain link. */
			if (blockIdx !== -1 && classGrainHead === 'sync')
				throw new SyntaxError(
					`Instance: class ${cls.name} — an instance field uses 'await' (a pending field at 'new'); '${cls.name}' must be declared 'mixed class' or 'async class'.`
				);

			/* ── Rule 1 (Encapsulation): the CLASS grain mandates the CONSTRUCTOR grain ──────────────────────
				*    sync class ⟹ sync ctor · async class ⟹ async ctor · mixed class ⟹ ANY ctor (universal adapter).
				*    Catches e.g. `async class { mixed constructor }`: the class mandates `await new`, so the mixed
				*    snapshot branch is structurally unreachable — an unrepresentable "fake mixed" state. */
			if (classGrainHead === 'sync' && ctorGrain !== 'sync')
				throw new SyntaxError(
					`Instance: class ${cls.name} — a 'sync class' requires a 'sync constructor', found ${art(ctorGrain)} '${ctorGrain} constructor'. Declare 'class ${cls.name}' as '${ctorGrain}', or make the constructor sync.`
				);
			if (classGrainHead === 'async' && ctorGrain !== 'async')
				throw new SyntaxError(
					`Instance: class ${cls.name} — an 'async class' requires an 'async constructor'. A '${ctorGrain} constructor' is rejected: the class mandates 'await new', so the snapshot path it offers can never run. Use 'async constructor', or declare the class '${ctorGrain === 'mixed' ? 'mixed' : 'sync'}'.`
				);

			/* ── Super-form mandate: the CTOR grain fixes the super-form (sync→`super()` · mixed→`yield super()`
				*    · async→`await super()`). Blind syntax, no override — the form IS the chain behavior. ── */
			if (hasSuper) {
				const want =
					ctorGrain === 'async' ? 'await' : ctorGrain === 'mixed' ? 'yield' : 'plain';
				const sf = x => (x === 'plain' ? 'super()' : `${x} super()`);
				if (superForm !== want)
					throw new SyntaxError(
						`Instance: class ${cls.name} — ${art(ctorGrain)} '${ctorGrain} constructor' must call '${sf(want)}', found '${sf(superForm)}'. The super-form is the chain link and is fixed by the constructor grain.`
					);
			} else if (ctor && ctorGrain !== 'sync')
				throw new SyntaxError(
					`Instance: class ${cls.name} — ${art(ctorGrain)} '${ctorGrain} constructor' must call '${ctorGrain === 'async' ? 'await' : 'yield'} super()'; the super-form is its chain link and cannot be omitted.`
				);

			/* ── procedural body await still requires an async/mixed context (V8 parity) ── */
			if (ctorBodyAwait && ctorGrain === 'sync')
				throw new SyntaxError(
					`Instance: class ${cls.name} — 'await' in a constructor body requires an 'async constructor' or 'mixed constructor' (await is only valid inside an async context).`
				);

			/* ── Rule 2 (Cap rule): a [sync] constructor is the CAP — it stops the chain, so it may extend ONLY
				*    a 'sync' parent. mixed/async constructors forward/take the chain and may extend ANY parent. A
				*    cross-file / opaque parent has no known grain and is ASSUMED sync (only a locally-declared
				*    mixed/async parent is known to strand). This ONE rule subsumes the former S2 (async-parent +
				*    sync-ctor) AND the sync-class transitive-purity rule: the cap is the only thing that strands,
				*    and `[sync]` is the only cap. grainOf is therefore keyed on the parent's CLASS grain. */
			const parentGrain = cls.ext ? grainOf[cls.ext] : undefined; // undefined → cross-file/opaque → assumed sync
			if (ctorGrain === 'sync' && parentGrain && parentGrain !== 'sync')
				throw new SyntaxError(
					`Instance: class ${cls.name} — a 'sync constructor' (bare 'super()') caps the settlement chain and may extend only a 'sync' parent; '${cls.ext}' is ${art(parentGrain)} '${parentGrain} class' whose pending state would be stranded. Forward the chain with a 'mixed' or 'async' constructor (yield/await super), or extend a sync class.`
				);

			/* ── SUPER-MODE: the cap / forward / take residue the runtime cannot re-derive, and the one
				*    kind-fact the emitted hook carries (everything else — both grains, Rule 1/2 — is resolved
				*    here at compile time and does NOT ride in the output):
				*      cap   (sync ctor)  — bare super(); the settlement does NOT wait on the parent (it is sync).
				*      forward (mixed)    — the runtime waits on the parent IFF the consumer used `await new`.
				*      take  (async ctor) — the settlement always waits on the parent. ── */
			const superChains = ctorGrain !== 'sync'; // mixed | async → the settlement fn awaits _super_

			/* ── splice & dice → snapshot (sync `function`) + settlement (`async function`), split at the async
				*  boundary. A throw in the sync prefix aborts `new` at the call site (a field-initializer throw);
				*  the settlement's returned promise IS what `await new` resolves. A pure-sync class (cap, no
				*  blocking field) carries `null` in the settlement slot. A single uniform async function was
				*  rejected: it turns a sync-prefix throw into a rejection, so `new` could not abort. ── */
			const ind = (a, n) => a.map(l => ' '.repeat(n) + l).join('\n');
			const asyncExists = blockIdx !== -1 || ctorBodyAwait || superChains;

			/* An `await super()` (async ctor) is a top-level await → every post-super field settles after it,
				*  so ALL fields go to the settlement (the snapshot is a shell). A bare/`yield` super keeps the sync
				*  fields in the snapshot; the async line then falls at the first blocking field. */
			const syncFields = [],
				asyncFields = [],
				defers = [];
			fields.forEach((f, i) => {
				if (f.defer) {
					defers.push(f.code);
					return;
				}
				if (ctorGrain === 'async' || (blockIdx !== -1 && i >= blockIdx))
					asyncFields.push(f.code);
				else syncFields.push(f.code);
			});
			const syncBody = [
				...(pre ? [pre] : []),
				...syncFields,
				...(asyncExists ? [] : [...(tail ? [tail] : []), ...defers])
			];
			const asyncBody = [
				...(superChains ? ['await _super_;'] : []),
				...asyncFields,
				...(tail ? [tail] : []),
				...defers
			];

			/* ── emit the fixed constructor + the snapshot / settlement functions (functions, not arrows: the
				*     runtime binds `this`). The super-MODE is encoded in the hook KEY (Instance | Instance.mixed |
				*     Instance.async); the manifest, if any, is the 4th and last argument. The emitted super() is
				*     always BARE — the yield/await semantics move into the settlement fn (`await _super_`) and the
				*     hook key; the source super-form survives only as a comment. ── */
			const syncFn = syncBody.length
				? `function () {\n${ind(syncBody, 8)}\n      }`
				: 'null';
			const asyncFn = asyncExists
				? `async function (_super_) {\n${ind(asyncBody, 8)}\n      }`
				: 'null';
			const mArg = manifest.length
				? `,\n      [${manifest.map(x => `'${x}'`).join(', ')}]`
				: '';
			// grain comment is now emitted for SYNTHESIZED ctors too (no `ctor &&`): its presence on a
			// constructor absent from source is itself the synthesis marker. sync stays unmarked.
			const ctorCmt = ctorGrain !== 'sync' ? `/*${ctorGrain}*/ ` : '';
			const superCmt = superForm !== 'plain' ? `/*${superForm}*/ ` : '';
			// super-MODE rides in the dispatch key: sync → bare Instance, else Instance.<grain>.
			const hookKey =
				ctorGrain === 'sync' ? INSTANCE : `Symbol.for('Instance.${ctorGrain}')`;
			const ctorEmit = `${ctorCmt}constructor(${params}) {
${superCmt}super(${superArgs});
this[${hookKey}](${cls.name},
	${syncFn},
	${asyncFn}${mArg}
);
}`;

			/* ── STATIC dual-function hook — the mirror of the instance ctor hook. Only `this` differs: in a
				*    static block `this` IS the class, so this.$x writes a static field. Eager statics run at
				*    class-eval (the sync prefix, in a plain `function` so a throw aborts the class definition);
				*    the async remainder, from the first gate onward, is the static settlement, pulled lazily. The
				*    partition is the instance partition, split at the first blocking static. The async fn takes no
				*    `_super_` — unlike the ctor hook there is NO super-join: a static block cannot call super()
				*    (it is a SyntaxError), and the parent's class-eval (its eager statics) already completed before
				*    this one ran. Waiting on a parent's *async* static is therefore plain `await` on the value —
				*    the parent's settlement is just a promise in flight — not an implicit join. The hook still
				*    carries super-mode `'cap'` for a uniform signature: a static never chains. ── */
			let staticEmit = '';
			if (staticFields.length) {
				const syncStatic = [],
					asyncStatic = [];
				staticFields.forEach((f, i) => {
					(staticBlockIdx !== -1 && i >= staticBlockIdx
						? asyncStatic
						: syncStatic
					).push(f.code);
				});
				const syncStaticFn = syncStatic.length
					? `function () {\n${ind(syncStatic, 8)}\n      }`
					: 'null';
				const asyncStaticFn = asyncStatic.length
					? `async function () {\n${ind(asyncStatic, 8)}\n      }`
					: 'null';
				const sMan = staticManifest.length
					? `,\n      [${staticManifest.map(x => `'${x}'`).join(', ')}]`
					: '';
				staticEmit = `static {
this[${INSTANCE}](this,
	${syncStaticFn},
	${asyncStaticFn}${sMan}
);
}`;
			}

			/* head is trusted — R10 already threw if a static `await` lacked async/mixed */
			let head = [...cls.head];

			const members = [...keep, ctorEmit, staticEmit].filter(Boolean).join('\n  ');
			return {
				decl: `class ${cls.name}${cls.ext ? ' extends ' + cls.ext : ''} {\n  ${members}\n}`,
				head,
				kwStart: cls.kwStart,
				close: cls.close
			};
		}

		function compile(src, opts = {}) {
			/* %Name → (Instance.app("Name")) — the app-class isolation bridge (Pass N).
			 * String/comment/regex-aware, operand-position only (so `a % b` stays
			 * modulo); template-literal ${…} interiors copy through untouched. Runs
			 * before lex, sibling to atDesugar. */
			const _appRefs = (src) => {
				const n = src.length; let out = '', i = 0;
				const KW = /^(?:return|typeof|new|void|delete|in|of|instanceof|case|do|else|yield|await|throw|extends)$/;
				const operand = () => {
					let j = out.length - 1;
					while (j >= 0 && /\s/.test(out[j])) j--;
					if (j < 0) return true;
					if (/[\w$]/.test(out[j])) {
						let k = j; while (k >= 0 && /[\w$]/.test(out[k])) k--;
						return KW.test(out.slice(k + 1, j + 1));
					}
					return !/[)\]]/.test(out[j]);
				};
				while (i < n) {
					const ch = src[i];
					if (ch === '"' || ch === "'") { const q = ch; out += ch; i++; while (i < n) { out += src[i]; if (src[i] === '\\') { i++; if (i < n) { out += src[i]; i++; } continue; } if (src[i] === q) { i++; break; } i++; } continue; }
					if (ch === '`') { out += ch; i++; let d = 0; while (i < n) { const t = src[i]; if (t === '\\') { out += t; i++; if (i < n) { out += src[i]; i++; } continue; } if (t === '$' && src[i + 1] === '{') { d++; out += '${'; i += 2; continue; } if (t === '}' && d > 0) { d--; out += t; i++; continue; } if (t === '`' && d === 0) { out += t; i++; break; } out += t; i++; } continue; }
					if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { out += src[i]; i++; } continue; }
					if (ch === '/' && src[i + 1] === '*') { out += '/*'; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i]; i++; } if (i < n) { out += '*/'; i += 2; } continue; }
					if (ch === '/' && operand()) { out += '/'; i++; let cls = false; while (i < n) { const t = src[i]; out += t; if (t === '\\') { i++; if (i < n) { out += src[i]; i++; } continue; } if (t === '[') cls = true; else if (t === ']') cls = false; else if ((t === '/' && !cls) || t === '\n') { i++; break; } i++; } continue; }
					if (ch === '%' && i + 1 < n && /[A-Za-z_$]/.test(src[i + 1]) && operand()) {
						i++; let j = i;
						while (j < n && /[\w$]/.test(src[j])) j++;
						out += '(Instance.app("' + src.slice(i, j) + '"))';
						i = j; continue;
					}
					out += ch; i++;
				}
				return out;
			};
			src = _appRefs(src);
			const T = lex(src);
			const diagnostics = [];
			// @y → ['@y']  (declarations emit this.@y; reads write this.@y — both lowered here. DSL directives are '@x' with no leading dot, so untouched.)
			const atDesugar = src => { // lower @-sigiled names (members, reads, bare '@') to bracket keys; strings/comments skipped so '@append' directives survive
				let o = '', i = 0; const N = src.length, id = ch => ch !== undefined && /[@\w$]/.test(ch);
				while (i < N) {
					const c = src[i];
					if (c === '"' || c === "'" || c === '`') { const q = c; o += c; i++; while (i < N) { const d = src[i]; o += d; i++; if (d === '\\') { if (i < N) { o += src[i]; i++; } } else if (d === q) break; } continue; }
					if (c === '/' && src[i+1] === '/') { while (i < N && src[i] !== '\n') o += src[i++]; continue; }
					if (c === '/' && src[i+1] === '*') { o += '/*'; i += 2; while (i < N && !(src[i] === '*' && src[i+1] === '/')) o += src[i++]; if (i < N) { o += '*/'; i += 2; } continue; }
					if (c === '.') { let j = i+1, r = ''; while (id(src[j])) r += src[j++]; if (r.includes('@')) { o += "['" + r + "']"; i = j; continue; } o += '.'; i++; continue; }
					if (id(c)) { let j = i, r = ''; while (id(src[j])) r += src[j++]; o += r.includes('@') ? "['" + r + "']" : r; i = j; continue; }
					o += c; i++;
				}
				return o;
			};
			const cs = findClasses(T);
			if (!cs.length) return { code: atDesugar(src), diagnostics };
			/* pre-pass: the CLASS grain of every class in the unit, so Rule 2 (the cap rule) can read a
				* locally-declared parent's grain (a parent in another file stays an opaque name → assumed sync). */
			const grainOf = {};
			for (const cls of cs) grainOf[cls.name] = headGrain(cls);
			let out = '',
				cursor = 0;
			for (const cls of cs) {
				const { decl, head, kwStart } = emitClass(
					T,
					src,
					cls,
					diagnostics,
					grainOf,
					opts
				);
				out += src.slice(cursor, kwStart);
				out += (head.length ? `/*${head.join(' ')}*/ ` : '') + decl;
				cursor = T[cls.close].e;
			}
			out += src.slice(cursor);
			return { code: atDesugar(out), diagnostics };
		}

		/* ── PicoPrettify (Pass Q) — the structural syntax highlighter, compiler-grade.
		 * Ported from the suite's highlightSource3 and rebuilt ON lex(): strings,
		 * templates, regexes and comments are opaque through the SAME scanners
		 * compile() trusts, and the .is sigil grammar — which lex's identifier
		 * class already spans ($ Δ ø) — classifies natively. Two modes:
		 *   format:false (default) — spans only, whitespace VERBATIM: output text
		 *                            content === input (editor-overlay safe)
		 *   format:true            — PicoPrettify's single-pass structural reflow
		 *                            (reindent + rewrap), the original behavior
		 * Span classes: sk keyword · ss string/template/regex · sn number ·
		 * sc comment · scl ClassName · sf call() · si sigil/reactive ·
		 * sl lifecycle @key · spu punctuation. */
		function prettify(rawCode, opts) {
			const format = !!(opts && opts.format);
			const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			const KEYWORDS = new Set(('class extends const let get set true false null undefined static var function return new delete '
				+ 'if else for in of while do switch case break continue default try catch finally throw typeof instanceof '
				+ 'await async import export this super yield void').split(' '));
			const LIFECYCLE = new Set(['mount', 'unmount', 'insertion', 'removal', 'rendered', 'transition', 'async', 'navigate', 'routeenter', 'routeleave', 'append', 'value', 'stamp']);
			const raw = String(rawCode == null ? '' : rawCode);
			const L = lex(raw);
			// classification pass — token stream → {cls, val}; sigil context is LOCAL
			// (an '@' or '::' binds the id that follows with no whitespace between)
			const out = [];
			const nextSolid = k => { for (let j = k + 1; j < L.length; j++) if (L[j].t !== 'ws') return L[j]; return null; };
			for (let k = 0; k < L.length; k++) {
				const tk = L[k];
				if (tk.t === 'ws') { out.push({ cls: null, val: tk.v }); continue; }
				if (tk.t === 'cm') { out.push({ cls: 'sc', val: tk.v, line: tk.v.slice(0, 2) === '//' }); continue; }
				if (tk.t === 'str' || tk.t === 're') { out.push({ cls: 'ss', val: tk.v }); continue; }
				if (tk.t === 'num') { out.push({ cls: 'sn', val: tk.v }); continue; }
				if (tk.t === 'id') {
					const v = tk.v;
					if (KEYWORDS.has(v)) { out.push({ cls: 'sk', val: v }); continue; }
					if (v[0] === '$' || v[0] === '\u0394' || v[0] === '\u00f8') { out.push({ cls: 'si', val: v }); continue; } // reactive tiers: $ $$ $$$ · Δ union · ø
					const nx = L[k + 1]; // trailing-effect suffix: name@ (id immediately followed by '@')
					if (nx && nx.t === 'pu' && nx.v === '@' && nx.s === tk.e) { out.push({ cls: 'si', val: v + '@' }); k++; continue; }
					if (/^[A-Z]/.test(v)) { out.push({ cls: 'scl', val: v }); continue; }
					const ns = nextSolid(k);
					if (ns && ns.t === 'pu' && ns.v === '(') { out.push({ cls: 'sf', val: v }); continue; }
					out.push({ cls: null, val: v }); continue;
				}
				// punctuation — sigil prefixes bind their trailing id: @name / @@ / ::name / %App / ψ
				const v = tk.v;
				if (v === '@') {
					const nx = L[k + 1];
					if (nx && nx.t === 'pu' && nx.v === '@' && nx.s === tk.e) { out.push({ cls: 'si', val: '@@' }); k++; continue; }
					if (nx && nx.t === 'id' && nx.s === tk.e) { out.push({ cls: LIFECYCLE.has(nx.v) ? 'sl' : 'si', val: '@' + nx.v }); k++; continue; }
					out.push({ cls: 'si', val: '@' }); continue;
				}
				if (v === ':') {
					const nx = L[k + 1], nn = L[k + 2];
					if (nx && nx.t === 'pu' && nx.v === ':' && nx.s === tk.e && nn && nn.t === 'id' && nn.s === nx.e) { out.push({ cls: 'si', val: '::' + nn.v }); k += 2; continue; }
				}
				if (v === '%') {
					const nx = L[k + 1];
					if (nx && nx.t === 'id' && nx.s === tk.e && /^[A-Z]/.test(nx.v)) { out.push({ cls: 'si', val: '%' + nx.v }); k++; continue; }
				}
				if (v === '\u03c8') { out.push({ cls: 'si', val: v }); continue; } // ψ — the triad accessor rides punct (lex gap noted)
				out.push({ cls: 'pu', val: v });
			}
			if (!format) { // overlay mode: verbatim text, spans only
				let html = '';
				for (const t of out) html += t.cls === null ? esc(t.val) : (t.cls === 'pu' ? '<span class="spu">' + esc(t.val) + '</span>' : '<span class="' + t.cls + '">' + esc(t.val) + '</span>');
				return html;
			}
			// ── format:true — the ORIGINAL PicoPrettify structural reflow, over tokens ──
			let result = '', indentLevel = 0, parenDepth = 0, requestNewline = false;
			const tab = '    ';
			const A = out.filter(t => t.cls !== null || t.val.trim() !== '' ? true : true); // keep all; ws is meaningful for inline runs
			const solidAfter = k => { for (let j = k + 1; j < A.length; j++) { const t = A[j]; if (t.cls === null && t.val.trim() === '') { if (t.val.includes('\n')) return { br: true }; continue; } return { t }; } return {}; };
			for (let k = 0; k < A.length; k++) {
				let t = A[k];
				const isWs = t.cls === null && t.val.trim() === '';
				const kind = t.cls === 'pu' ? (t.val === '{' ? 'open' : t.val === '}' ? 'clos' : t.val === ';' ? 'semi' : t.val === '(' ? 'opn_p' : t.val === ')' ? 'cls_p' : /^[\[\],.]$/.test(t.val) ? 'spu' : 'pu') : t.cls;
				if (requestNewline) {
					if (isWs) continue;
					if (kind === 'clos') { indentLevel = Math.max(0, indentLevel - 1); result = result.replace(/\s+$/, '') + '\n' + tab.repeat(indentLevel); requestNewline = false; }
					else if (kind !== 'semi' && kind !== 'spu' && kind !== 'cls_p') { result = result.replace(/\s+$/, '') + '\n' + tab.repeat(indentLevel); requestNewline = false; }
				} else if (kind === 'clos') {
					indentLevel = Math.max(0, indentLevel - 1);
					if (!result.endsWith('\n' + tab.repeat(indentLevel))) result = result.replace(/\s+$/, '') + '\n' + tab.repeat(indentLevel);
				}
				if (isWs) { result += /\s$/.test(result) || result === '' ? '' : ' '; continue; } // collapse runs; reflow owns line breaks
				switch (kind) {
					case 'sc':
						result += '<span class="sc">' + esc(t.val) + '</span>';
						if (t.line) requestNewline = true;
						break;
					case 'open': {
						const peek = solidAfter(k);
						if (peek.t && peek.t.cls === 'pu' && peek.t.val === '}') { // {} — the empty pair, inline
							if (/(?:\w|\]|\))(?:<\/span>)?$/.test(result)) result += ' ';
							result += '<span class="spu">{}</span>';
							while (A[k + 1] && !(A[k + 1].cls === 'pu' && A[k + 1].val === '}')) k++;
							k++;
							break;
						}
						if (/(?:\w|\]|\))(?:<\/span>)?$/.test(result)) result += ' ';
						result += '<span class="spu">{</span>'; indentLevel++; requestNewline = true;
						break;
					}
					case 'clos': {
						result += '<span class="spu">}</span>';
						if (parenDepth === 0) {
							const peek = solidAfter(k);
							const cont = peek.t && peek.t.cls === 'sk' && /^(?:catch|else|finally|while)$/.test(peek.t.val);
							if (!cont) requestNewline = true;
						}
						break;
					}
					case 'semi': {
						result += '<span class="spu">;</span>';
						if (parenDepth === 0) {
							const peek = solidAfter(k);
							const inlineCm = peek.t && peek.t.cls === 'sc';
							if (!inlineCm) requestNewline = true;
						} else result += ' ';
						break;
					}
					case 'opn_p': parenDepth++; result += '<span class="spu">(</span>'; break;
					case 'cls_p': parenDepth = Math.max(0, parenDepth - 1); result += '<span class="spu">)</span>'; break;
					case 'spu': case 'pu': result += '<span class="spu">' + esc(t.val) + '</span>'; break;
					default: result += t.cls === null ? esc(t.val) : '<span class="' + t.cls + '">' + esc(t.val) + '</span>';
				}
			}
			return result.trim();
		}

		const API = { compile, lex, findClasses, splitMembers, RULES, prettify, version: '7.2.0' };
		if (typeof module !== 'undefined' && module.exports) module.exports = API;

		// ════ AsyncReferenceError — the type the async half rethrows (an awaited binding that never resolved) ════

		global.AsyncReferenceError = class AsyncReferenceError extends ReferenceError {
			constructor(message, options) {
				super(message, options);
				this.name = 'AsyncReferenceError';
			}
		};

		return API;
}


/* ===== v8 DSL ===== */
// DSL-v8.js — placement/selection grammar as a loadable Instance plugin.
// Resolver contract: default export is a factory(GLOBAL) returning the extension value.
function DSL_PLUGIN(GLOBAL) {
  const document = GLOBAL.document ?? globalThis.document;
class DSLError extends Error {
  constructor(msg, raw = '') {
    super(`[DSL] ${msg}${raw ? ` — "${raw}"` : ''}`);
    this.name = 'DSLError';
  }
}

/* ═══════════════════════════════════════════════════════════════
   DSL – final grammar (with normalisation)
   ═══════════════════════════════════════════════════════════════ */
class DSL {
  /* ── Public API (unchanged) ────────────────────────────────────── */
  static parse(str)    { return new DSL(str)._exec(); }
  static targets(ast, root) { return ast ? new DSL(ast.raw)._resolve(ast, root ?? document) : []; }
  static place(ast, el, target) { if (ast && el && target) DSL.#insert(ast.placement, el, target, ast.ordinalIndex); return el; }
  static route(ast, el, root) { return DSL.place(ast, el, DSL.targets(ast, root)[0]); }
  static pipe(str, el, root) { return DSL.route(DSL.parse(str), el, root); }

  /* ── Reserved vocabulary ───────────────────────────────────────── */
  // verbs: prepend/append are container-inserts ≡ firstchild/lastchild
  static #VERB = {
    before: 'before', after: 'after', wrap: 'wrap', replace: 'replace',
    prepend: 'firstchild', append: 'lastchild'
  };
  static #ORDINALS = new Map([
    ['first',1],['second',2],['third',3],['fourth',4],['fifth',5],
    ['sixth',6],['seventh',7],['eighth',8],['ninth',9],['tenth',10],['last',-1]
  ]);
  static #ORD_RE = /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\b/i;

  // absolute generation (from the root selector) of a depth word
  static #genOf(word) {
    if (word === 'child') return 1;
    if (!/^(?:great-)*grandchild$/.test(word)) return 0;
    return (word.match(/great-/g)?.length ?? 0) + 2;
  }

  #raw; #s;
  constructor(str) { this.#raw = str; this.#s = String(str ?? '').trim(); }

  #ast(props = {}) {
    return Object.assign(
      { placement: 'append', container: null, singular: false, raw: this.#raw }, props
    );
  }

  /* ── Top-level parser ──────────────────────────────────────────── */
  _exec() {
    let s = this.#s;
    if (!s) throw new DSLError('Empty selector', this.#raw);

    // sigil + base plurality
    let singular = true;
    if (s.startsWith('@@'))      { singular = false; s = s.slice(2).trim(); }
    else if (s.startsWith('%'))  { return this.#instanceAst(s.slice(1), false); } // bare %Name (singular)
    else if (s.startsWith('@'))  { s = s.slice(1).trim(); }
    else throw new DSLError('Selectors must start with @ or @@', this.#raw);

    if (!s) throw new DSLError('Empty selector after sigil', this.#raw);

    // @every / @each prefix → plural — but "every <ordinal>" is ordinal repetition, not this
    if (/^(?:every|each)\b/i.test(s)) {
      const after = s.replace(/^(?:every|each)\s*/i, '');
      if (!DSL.#ORD_RE.test(after)) {
        singular = false;
        s = after.trim();
        if (!s) throw new DSLError('Missing selector after @every/@each', this.#raw);
      }
    }

    // %Name after the sigil → instance selector (whole body)
    if (s.startsWith('%')) return this.#instanceAst(s.slice(1), !singular);

    const defaultPlural = !singular;
    s = this.#normalize(s);

    // verb? (placement acts on a selected set)
    const vm = /^(before|after|wrap|replace|prepend|append)\b/i.exec(s);
    if (vm) {
      const op = DSL.#VERB[vm[1].toLowerCase()];
      let rest = s.slice(vm[0].length).trim();
      rest = rest.replace(/^(?:to|within|of)\s+/i, '').trim(); // optional connector sugar
      if (!rest) throw new DSLError(`Placement "${vm[1]}" requires a selector`, this.#raw);
      const container = this.#parseContainer(rest, defaultPlural);
      return this.#ast({ placement: op, container, singular });
    }

    // verbless: the expression *is* the placement (the new element takes the named slot)
    const head = this.#matchOrdinalHead(s);
    if (head) {
      let op, ordinalIndex;
      if (head.ordinal === 1)       op = 'firstchild';
      else if (head.ordinal === -1) op = 'lastchild';
      else { op = 'nth'; ordinalIndex = head.ordinal; }
      const container = this.#parseContainer(head.rest, defaultPlural);
      return this.#ast({ placement: op, container, singular, ordinalIndex });
    }

    // bare selector → append into the matched element(s)
    const container = this.#parseContainer(s, defaultPlural);
    return this.#ast({ placement: 'append', container, singular });
  }

  #instanceAst(name, plural) {
    return this.#ast({
      instance: true, singular: !plural,
      container: { type: 'selector', selector: name.trim(), plural, instance: true }
    });
  }

  // one-word firstchild/lastchild ≡ the ordinals "first/last child"
  // (not when it is part of a selector token like .firstchild)
  #normalize(s) { return s.replace(/(?<![.#\w-])(first|last)child\b/gi, '$1 child'); }

  /* ── Container parser (recursive, right-to-left via the first " of ") ── */
  #parseContainer(str, defaultPlural) {
    str = str.trim();

    const head = this.#matchOrdinalHead(str);
    if (head) {
      const inner = this.#parseContainer(head.rest, defaultPlural);
      return {
        type: 'ordinal',
        ordinal: head.ordinal, fromLast: head.fromLast, every: head.every,
        depthWord: head.depthWord, filter: head.filter, container: inner
      };
    }

    // base selector segment
    let plural = defaultPlural;
    let sel = str;
    if (/^(?:every|each)\b/i.test(sel)) {
      plural = true;
      sel = sel.replace(/^(?:every|each)\s*/i, '').trim();
      if (!sel) throw new DSLError('Empty selector after every/each', this.#raw);
    }
    if (sel.startsWith('%')) return { type: 'selector', selector: sel.slice(1).trim(), plural, instance: true };

    // ancestor / route arrows — longest symbols first so <= / <<= are not shadowed by < / <<
    for (const a of [
      { sym: '<<=', kind: 'route',    dir: 'any' },
      { sym: '<=',  kind: 'route',    dir: 'immediate' },
      { sym: '<<',  kind: 'ancestor', dir: 'any' },
      { sym: '<',   kind: 'ancestor', dir: 'immediate' },
    ]) {
      const idx = sel.indexOf(a.sym);
      if (idx !== -1) {
        const left = sel.slice(0, idx).trim();
        const target = sel.slice(idx + a.sym.length).trim();
        if (!left || !target) throw new DSLError(`Invalid arrow expression "${a.sym}"`, this.#raw);
        const node = { type: 'selector', selector: left, plural, target };
        node[a.kind] = a.dir;
        return node;
      }
    }

    if (!sel) throw new DSLError('Empty selector', this.#raw);
    return { type: 'selector', selector: sel, plural };
  }

  /* ── Ordinal head: [the] [every] <ord> [from last] [depth] [selector] of <rest> ──
     Returns null when there is no " of " (→ it is a plain selector segment).
     Throws when " of " is present but the leading word is not a valid ordinal
     ("of" is reserved and only ever introduces an ordinal container). */
  #matchOrdinalHead(str) {
    const m = /\sof(?=\s|$)/i.exec(str); // " of " or a trailing/dangling "of"; ignores "-of-" inside selectors
    if (!m) return null;

    let head = str.slice(0, m.index).trim();
    const rest = str.slice(m.index + m[0].length).trim();
    if (!rest) throw new DSLError('Missing container after "of"', this.#raw);

    head = head.replace(/^the\s+/i, '');
    let every = false;
    if (/^every\s+/i.test(head)) { every = true; head = head.replace(/^every\s+/i, '').trim(); }

    const om = /^([a-z]+)\b/i.exec(head);
    if (!om) throw new DSLError('Malformed ordinal expression', this.#raw);
    const ordWord = om[1].toLowerCase();
    if (!DSL.#ORDINALS.has(ordWord)) throw new DSLError(`Invalid ordinal "${ordWord}"`, this.#raw);
    const ordinal = DSL.#ORDINALS.get(ordWord);

    let tail = head.slice(om[0].length).trim();

    let fromLast = false;
    if (/^from\s+last\b/i.test(tail)) { fromLast = true; tail = tail.replace(/^from\s+last\s*/i, '').trim(); }

    let depthWord = null;
    const dm = /^((?:great-)*grandchild|child)\b/i.exec(tail);
    if (dm) { depthWord = dm[1].toLowerCase(); tail = tail.slice(dm[0].length).trim(); }

    return { ordinal, fromLast, every, depthWord, filter: tail || null, rest };
  }

  /* ── Resolution (selection mode) ───────────────────────────────── */
  _resolve(ast, scope) {
    if (ast.instance) throw new DSLError('Instance selector (%) resolution is not yet implemented', ast.raw);
    if (!ast.container) throw new DSLError('No container in AST', ast.raw);
    const { els } = this.#resolveContainer(ast.container, scope);
    if (!els.length) throw new DSLError('No elements found for the given expression', ast.raw);
    return els;
  }

  // returns { els, gen }, where gen is the absolute generation from the root selector
  #resolveContainer(c, scope) {
    if (c.type === 'selector') {
      if (c.instance) throw new DSLError('Instance selector (%) resolution is not yet implemented', this.#raw);
      let raw = [...scope.querySelectorAll(c.selector)];

      if (c.ancestor) {
        raw = raw.filter(el => c.ancestor === 'immediate'
          ? !!el.parentElement?.matches(c.target)
          : !!el.closest(c.target));
      } else if (c.route) {
        const seen = new Set();
        for (const el of raw) {
          const found = c.route === 'immediate'
            ? (el.parentElement?.matches(c.target) ? el.parentElement : null)
            : el.closest(c.target);
          if (found) seen.add(found);
        }
        raw = [...seen];
      }
      return { els: c.plural ? raw : raw.slice(0, 1), gen: 0 };
    }

    // ordinal container
    const { els: innerEls, gen: innerGen } = this.#resolveContainer(c.container, scope);
    const thisGen = c.depthWord ? DSL.#genOf(c.depthWord) : innerGen + 1;
    const descend = Math.max(1, thisGen - innerGen);

    const out = [];
    for (const inner of innerEls) {
      let pool = DSL.#descend(inner, descend);
      if (c.filter) pool = pool.filter(e => e.matches(c.filter));
      if (c.every) out.push(...DSL.#everyNth(pool, c.ordinal, c.fromLast));
      else { const picked = DSL.#pickNth(pool, c.ordinal, c.fromLast); if (picked) out.push(picked); }
    }
    return { els: out, gen: thisGen };
  }

  static #descend(root, d) {
    let cur = [...root.children];
    for (let i = 1; i < d; i++) cur = cur.flatMap(e => [...e.children]);
    return cur;
  }

  static #pickNth(pool, ord, fromLast) {
    if (!pool.length) return null;
    if (fromLast) { const i = pool.length - ord; return i >= 0 ? pool[i] : null; }
    if (ord === -1) return pool[pool.length - 1];
    return pool[ord - 1] ?? null;
  }

  static #everyNth(pool, ord, fromLast) {
    const out = [];
    if (ord === -1) { if (pool.length) out.push(pool[pool.length - 1]); return out; }
    if (fromLast) { for (let i = pool.length - ord; i >= 0; i -= ord) out.push(pool[i]); }
    else { for (let i = ord - 1; i < pool.length; i += ord) out.push(pool[i]); }
    return out;
  }

  /* ── Insertion ─────────────────────────────────────────────────── */
  static #insert(placement, element, target, ordinalIndex) {
    switch (placement) {
      case 'before':     target.insertAdjacentElement('beforebegin', element); break;
      case 'after':      target.insertAdjacentElement('afterend',    element); break;
      case 'firstchild': target.insertAdjacentElement('afterbegin',  element); break;
      case 'nth': {
        const ref = target.children[(ordinalIndex ?? 1) - 1];
        if (ref) target.insertBefore(element, ref); else target.appendChild(element);
        break;
      }
      case 'wrap':       target.insertAdjacentElement('beforebegin', element); element.appendChild(target); break;
      case 'replace':    target.insertAdjacentElement('beforebegin', element); target.remove(); break;
      case 'lastchild':
      case 'append':
      default:           target.appendChild(element); break;
    }
  }
}

  return { DSL, DSLError };
}


/* ===== BIOS6 core / Instance runtime ===== */
// Instance-0.86 — DOM_UEFI runtime (self-settling thenable elements; sigil reactivity; await-new construction)
var __INSTANCE_READY__ = (async function DOM_UEFI_086d(factory, build) {

	const EXTMAP = Object.create(null);

	// ═══ §EXT  EXTENSION RESOLUTION PIPELINE  (ported from 0.76.0) ═══
	//   build.EXTMAP is resolved here via a `for await` async generator, BEFORE the
	//   rest of the factory runs. Load order is GUARANTEED sequential. By value type:
	//     string          → dynamic import()   (needs static server + CORS)
	//     async generator → iterated; last yield = the extension
	//     Promise         → awaited
	//     null/undefined  → skipped silently
	//     anything else   → used directly (inline object/class/fn, zero cost)
	async function* resolver(extmap = {}) {
		for (const [key, val] of Object.entries(extmap)) {
			if (key.startsWith('_')) continue;
			if (val == null) continue;
			try {
				if (typeof val === 'string') {
					const mod = await import(val);
					yield [key, mod.default ?? mod[key] ?? mod];
				} else if (
					typeof val === 'function' &&
					val.constructor?.name === 'AsyncGeneratorFunction'
				) {
					let r;
					for await (const step of val()) r = step;
					yield [key, r];
				} else if (typeof val?.then === 'function') { yield [key, await val]; } 
				else yield [key, val];
			} catch (e) {
				console.log(`[Instance] ✗ Extension "${key}" failed to load:`, e);
			}
		}
	}
	
	/** 
	* @description Polyfill. Arity 2, non-enumerable, native [[Construct]] stripped. No cross-pollination.
	* Prototype: WeakMap | Map .getOrInsert{Computed}
	*/
	const GLOBAL = ((_) => typeof globalThis !== _ ? globalThis 
		: typeof window !== _ ? window 
		: typeof self !== _ ? self 
		: typeof global !== _ ? global 
		: this ?? new Function('return this')()
	)(typeof void function($0, $1, $2) {
		const ensure = (proto, name) => {
			if (!Object.prototype.hasOwnProperty.call(proto, name)) {
				Object.defineProperty(proto, name, {
					value: {
						[$1](key, dv) { 
							return this.has(key) ? this.get(key) : (this.set(key, dv), dv);
						},
						[$2](key, fn) {
							if (this.has(key)) return this.get(key);
							if (typeof fn !== $0) throw new TypeError(`${$2} requires a ${$0}`);
							const computed = fn(key, this);
							this.set(key, computed);
							return computed;
						}
					}[name],
					writable: true, configurable: true, enumerable: false
				});
			}
		};
		for (const proto of [WeakMap.prototype, Map.prototype]) { ensure(proto, $1); ensure(proto, $2); }
	}('function', 'getOrInsert', 'getOrInsertComputed'));

	for await (const [key, val] of resolver(build)) {
		EXTMAP[key] = typeof val === 'function' ? val(GLOBAL) : val;
		console.log(`%cInstance Plugin "${key}" loaded`, 'color: #a104ff');
	}

	const Instance = await factory(GLOBAL, EXTMAP, undefined);

	// ── IVC — Instance Version Controller ─────────────────────────────── (author-spec, Pass Q7)
	//
	// Exposes Instance on the global scope via a well-known Symbol so that:
	//   1. Multiple versions of Instance can coexist without collision
	//   2. User code can retrieve the active Instance without a named global:
	//        const Instance = globalThis[Symbol.for('Instance')]();
	//   3. Classes can be reassigned without const (no rewrite needed):
	//        class CatDiv extends Div { ... }
	//        CatDiv = Instance.extend(CatDiv);   // ← let/var or bare assignment
	//   4. A future version string argument allows version-gated behaviour:
	//        const Instance = globalThis[Symbol.for('Instance')]('0.82');
	//
	// IVC is intentionally minimal right now — version routing is stubbed.
	// When multiple versions are in play, IVC will resolve the correct
	// Instance class from a registry keyed by semver range.
	// NOTE: the registered symbol is double-duty by design — the SAME
	// Symbol.for('Instance') keys the compiler's per-level definition hook on
	// ELEMENT chains; holders differ (globalThis vs prototypes), so no collision.
	function IVC(version) {
		// Stub: version routing reserved for future use.
		// Currently always returns the active Instance regardless of argument.
		if (typeof version !== 'string') return Instance;
		return Instance;
	}
	// Register on the global object as a non-enumerable, non-configurable
	// getter.  Non-configurable means no third party can overwrite the
	// Symbol.for('Instance') slot once this file has loaded — and a LATER
	// Instance version detects the existing broker instead of throwing
	// (first-wins; the future registry hands off from here).
	if (!Reflect.getOwnPropertyDescriptor(GLOBAL, Symbol.for('Instance')))
		Reflect.defineProperty(GLOBAL, Symbol.for('Instance'), {
			get()        { return IVC; },
			configurable: false,
			enumerable:   false,
		});
	Reflect.defineProperty(GLOBAL, 'Instance', { value: Instance, configurable: true });
	try { if (GLOBAL.jQuery && GLOBAL.jQuery.fn) Instance.mergeJQuery(GLOBAL.jQuery); } catch (e) {} // jQuery merge — ON BY DEFAULT when present (Pass Q7); late loaders call Instance.mergeJQuery() themselves
	try { Instance.initEvents(GLOBAL); } catch (e) {} // DOM-event vocabulary (Pass Q8): MouseDown/KeyUp/… minted post-typeset, collision-postfixed, unmint-recorded
	if (typeof define === 'function' && define.amd) define([], () => Instance);

	return Instance;

}(async function BIOS6(global, build) {


'use strict';

const ø = (o = {}) => ({ __proto__: null, ...o });

const REGISTRY = ø(); // ClassName → element class (every generated class)

const W3 = 'https://www.w3.org/';

const { COMPILER, CHIMERA, DSL: __DSL } = build;
const { DSL, DSLError } = __DSL;
const { Signal, Substrate, reactive, layer, REACTIVE_STORE } = CHIMERA;

void new Substrate('L5'); // installs the arena

/**
* @description ── core Instance symbols: compiler-emitted hook keys + sentinels. These MUST precede the
*  Symbols class, which uses INSTANCE / INSTANCE_MIXED / INSTANCE_ASYNC / EFFECTS as computed
*  method keys (evaluated at class-definition). EFFECTS is the explicit arm-hook — a const like
*  the INSTANCE family, NOT a minted slot, so its key resolves and no accessor clobbers it. ── 
*/
const INSTANCE 		 = Symbol.for('Instance');			// per-level hook the compiler emits (sync — superMode 'cap')
const INSTANCE_MIXED = Symbol.for('Instance.mixed');	// mixed grain → superMode 'forward'
const INSTANCE_ASYNC = Symbol.for('Instance.async');	// async grain → superMode 'take'
const EFFECTS 		 = Symbol.for('Instance.effects');	// optional explicit effect-arm hook
const TEARDOWN		 = Symbol.for('Instance.teardown');		// the disposal protocol, sync face (Pass Q4) — house analog of Symbol.dispose
const TEARDOWN_ASYNC = Symbol.for('Instance.teardown.async');	// …async face — house analog of Symbol.asyncDispose (awaits @removal/@unmount transitions)
const PENDING		 = Symbol.for('Instance.??');		// a field that has not settled
const POISONED		 = Symbol.for('Instance.!!');		// a field whose settlement rejected

const INSTANCE_TYPES = new Set([ 'text/instance', 'application/instance', 'instance', 'text/is', '.is', 'data:text/javascript,']);

/* ═══════════════════════════════════════════════════════════════════════════
 * ELEMENT-KEYED WEAK STATE — declared here, MINTED in ONE place: the Symbols
 * static block (§3, the BEHAVIORS loop). That loop is the single site where
 * every WeakMap/WeakSet keyed by an element is born; each store also gets a
 * symbol accessor on Instance (class + prototype) whose body dispatches on
 * typeof this — the house state pattern:
 *
 *     object[SYMBOL]  →  weakly-held store  →  switch (typeof this)
 *       'function' = the class  → class-wide semantics
 *       'object'   = an element → per-instance semantics
 *
 * The bindings below are the HOT-PATH aliases (direct closure reads for the
 * metaclass traps and event plumbing — a symbol accessor per $-read would
 * cost). They are `let` because assignment happens inside the mint loop;
 * nothing touches them before boot completes. Global Maps/Sets that must NOT
 * be GC'd (REGISTRY, APPS, _NAMESPACES, …) are ordinary consts — only
 * element-keyed state routes through the mint.
 *
 *   ARMED            WeakSet   elements whose effect methods are armed
 *   STORE            WeakMap   element → Signal.Store (the off-element store)
 *   AWAITING         WeakMap   element → pending settle chain (virtual `then`)
 *   CONSTRUCTS       WeakMap   element → construction bookkeeping
 *   EFFECT_NAMES     WeakMap   element → named-effect registry
 *   LC_LISTENERS     WeakMap   element → Map(lifecycleKey → Set<fn>) (fan bodies)
 *   _EV              WeakMap   element → event bookkeeping (on/off tiers)
 *   _SUBS            WeakMap   element → Set<observer> (subscribe/notify)
 *   _NS_CACHE        WeakMap   element → namespace facade (form/input/…)
 *   _NS_CLEAN        WeakMap   element → Set<cleanup> (facade teardown)
 *   LC_MOUNTED / LC_DETACHED / LC_HANDLED_EXIT / LC_HANDLED_ENTER
 *                    WeakSet   Lifecycle phase existence flags
 *   ACTIVE_TR        WeakMap   element → Set<fullKey> — transition dedupe;
 *                              THIS IS the pre-provisioned ACTIVE_TRANSITIONS
 *                              slot (Pass L had duplicated it — folded)
 *   CLAIMED          WeakSet   adopted markup nodes (template-app adoption)
 * ═══════════════════════════════════════════════════════════════════════════ */
let ARMED, STORE, AWAITING, CONSTRUCTS, EFFECT_NAMES,
	LC_LISTENERS, _EV, _SUBS, _NS_CACHE, _NS_CLEAN,
	LC_MOUNTED, LC_DETACHED, LC_HANDLED_EXIT, LC_HANDLED_ENTER,
	ACTIVE_TR, CLAIMED;

/* ── feature state & data (hoisted — nothing below the Lifecycle install declares top-level state) ── */
let _ROUTER; // = Router (assigned at its class site, §10) — the unified class IS the router API; kept as a `let` so §10 stays a pure declaration region
let COLLECTION_STATIC; // string-verb map for the Meta readStatic fallback — derived at the Collection class site (§7)
const _RT = {
	config: { base: '', history: 'push', scroll: true },
	tables: new Map(), guards: [], listeners: { navigate: new Set(), error: new Set() },
	current: { path: '/', query: {}, hash: '', params: {} },
	path: null, wired: false
};
const _ENGINE = { on: false, treeBase: null, hp: null, ctors: new Map(), pairs: [] }; // pairs: [tagProto, Meta, apply(on)] — apply is the engine-mode chain splice (Pass Q6)
const _TAG_IFACES = new Map(); // IFACE_NAME → synthesized interface ctor — every tag gets its OWN prototype, never a shared one (Pass Q6)
const _IFACES = []; // every metaclass's method-layer iface — late merges (jQuery) retro-graft here (Pass Q7)

/* ── §DOM EVENTS (Pass Q8) — events are the PULSE face of signals ──────────────
 * new MouseDown({…}) mints a REAL native event and FIRES it (creation is
 * occurrence; dispatch is synchronous, so the returned event carries the outcome
 * — .defaultPrevented is readable). Bare MouseDown({…}) is the inert factory.
 * String-first-arg (new InputEvent('input', …)) is the native signature —
 * pure passthrough for foreign code. el.on(MouseDown, fn) subscribes through ONE
 * shared native listener per (target, type) — the PUMP — feeding a kernel pulse:
 * a primitive-seq store node (monotonic ⇒ dedup can never bite) delivered through
 * arm-swallowed effects (⇒ no replay) behind a run-queue drain (⇒ handlers are
 * ATOMIC; self/cross re-entrant fires deliver in order — pulseprobe 8/8,
 * domevents-isolation 28/28). Subscriptions on ELEMENTS register in a drain set
 * emptied by both dispose sweeps — events die with their element. */
const EVT_TYPE = Symbol.for('Instance.event.type');
const _EVT_PUMPS = new WeakMap(); // target → Map(type → { st, seq, last, q, running, count, unlisten })
const _EVT_SUBS  = new WeakMap(); // element → Set(disposer) — drained at dispose
const _EVT_WINDOWISH = new Set(['storage', 'hashchange', 'popstate', 'beforeunload', 'unload', 'resize', 'load']);
const _EVT_HINTS = ø({ dblclick: 'DblClick', contextmenu: 'ContextMenu', hashchange: 'HashChange',
	visibilitychange: 'VisibilityChange', beforeunload: 'BeforeUnload',
	fullscreenchange: 'FullscreenChange', fullscreenerror: 'FullscreenError', popstate: 'PopState' });
const _EVT_GRAMMAR = ø({
	'': ('click|dblclick|scroll|storage|hashchange|visibilitychange|beforeunload|' +
	     'unload|fullscreenchange|fullscreenerror|copy|cut|paste|contextmenu|input|' +
	     'submit|reset|select|wheel|resize|popstate|drop|abort|change|load'),
	focus: '|in|out', key: 'down|up|press',
	mouse: 'down|up|move|over|out|enter|leave',
	pointer: 'down|up|move|over|out|enter|leave|cancel',
	touch: 'start|end|move|cancel', drag: '|start|end|enter|leave|over',
	transition: 'start|end|cancel', animation: 'start|end|iteration' });
const _EVT_IFACE = t =>
	/^mouse|^click$|^dblclick$|^contextmenu$/.test(t) ? 'MouseEvent'
	: /^key/.test(t) ? 'KeyboardEvent' : /^pointer/.test(t) ? 'PointerEvent'
	: /^touch/.test(t) ? 'TouchEvent'  : /^focus/.test(t) ? 'FocusEvent'
	: /^drag|^drop$/.test(t) ? 'DragEvent'
	: /^transition/.test(t) ? 'TransitionEvent' : /^animation/.test(t) ? 'AnimationEvent'
	: t === 'wheel' ? 'WheelEvent' : t === 'input' ? 'InputEvent' : t === 'submit' ? 'SubmitEvent'
	: t === 'storage' ? 'StorageEvent' : t === 'hashchange' ? 'HashChangeEvent'
	: t === 'popstate' ? 'PopStateEvent' : 'Event';

function _evtPump(target, type) {
	let m = _EVT_PUMPS.get(target);
	if (!m) _EVT_PUMPS.set(target, m = new Map());
	let p = m.get(type);
	if (!p) {
		const st = new Signal.Store();
		st.write('$seq', 0);
		p = { st, seq: 0, last: null, q: [], running: false, count: 0, unlisten: null, subs: new Set() };
		/* TWO delivery planes, deliberately (the consensus lesson):
		 *  · the SIGNAL face — every fire writes the $seq kernel node, so effects/
		 *    computeds can subscribe to the pulse like any signal (combinators live);
		 *  · the HANDLER face — fns deliver through the atomic run-queue Set,
		 *    UNTRACKED by construction: a handler reading $state must not become a
		 *    consensus dependency of its own event (it would fire every OTHER pulse). */
		const pump = ev => {
			p.q.push(ev);
			if (p.running) return;
			p.running = true;
			try {
				let guard = 0;
				while (p.q.length) {
					if (++guard > 1024) throw new Error('[Instance.Events] cascade overflow (>1024 nested fires)');
					p.last = p.q.shift();
					p.st.write('$seq', ++p.seq);                      // signal face first
					for (const fn of [...p.subs]) { try { fn.call(target, p.last, target); } catch (err) { setTimeout(() => { throw err; }, 0); } } // handler face: atomic, untracked, one bad handler can't kill the drain
				}
			} finally { p.running = false; }
		};
		target.addEventListener(type, pump);
		p.unlisten = () => target.removeEventListener(type, pump);
		m.set(type, p);
	}
	return p;
}
function _evtSubscribe(target, type, fn) {
	const p = _evtPump(target, type);
	p.count++;
	p.subs.add(fn); // handler face: no kernel effect ⇒ no tracking ⇒ consensus can never bite a handler
	let dead = false;
	const disposer = () => {
		if (dead) return; dead = true;
		p.subs.delete(fn);
		if (--p.count === 0) { try { p.unlisten(); } catch (e) {} const m = _EVT_PUMPS.get(target); if (m) m.delete(type); }
		const set = _EVT_SUBS.get(target); if (set) set.delete(disposer);
	};
	if (target && target.nodeType === 1) { // element targets ride the teardown spine
		let set = _EVT_SUBS.get(target);
		if (!set) _EVT_SUBS.set(target, set = new Set());
		set.add(disposer);
	}
	return disposer;
}
/* ── event HANDLES + combinators (Pass Q8b — author-spec: "Events are Signals") ──
 * Bare-call MouseDown(init) returns the inert native event DECORATED into a handle:
 * the init doubles as a subscription CONFIG (own-key equality filter), and the
 * combinator verbs derive new handles — map (transform + occurrence index),
 * combine (latest-pair, fires on either), sleep (per-occurrence delay),
 * chain (sequence: this-then-that). Handles subscribe via el.on(handle, cb) or
 * handle.on(el, cb); derivations are target-agnostic recipes bound at subscribe. */
const EVT_HANDLE = Symbol.for('Instance.event.handle');
const _specOf = x => x && x[EVT_HANDLE] ? x[EVT_HANDLE]
	: (typeof x === 'function' && typeof x[EVT_TYPE] === 'string') ? { kind: 'leaf', type: x[EVT_TYPE] }
	: null;
function _hSubscribe(spec, target, cb) {
	switch (spec.kind) {
		case 'leaf': {
			const cfg = spec.config;
			const fn = !cfg ? cb : (e, t) => { for (const k in cfg) { if (k === 'target' || k === 'bubbles' || k === 'cancelable' || k === 'composed') continue; if (e[k] !== cfg[k]) return; } cb(e, t); };
			return _evtSubscribe(target, spec.type, fn);
		}
		case 'map': { let i = 0; return _hSubscribe(spec.src, target, (v, t) => cb(spec.fn(v, i++), t)); }
		case 'sleep': {
			const ids = new Set();
			const off = _hSubscribe(spec.src, target, (v, t) => { const id = setTimeout(() => { ids.delete(id); cb(v, t); }, spec.ms); ids.add(id); });
			return () => { off(); for (const id of ids) clearTimeout(id); ids.clear(); };
		}
		case 'combine': {
			let a, b;
			const off1 = _hSubscribe(spec.src,   target, v => { a = v; cb(spec.fn(a, b), target); });
			const off2 = _hSubscribe(spec.other, target, v => { b = v; cb(spec.fn(a, b), target); });
			return () => { off1(); off2(); };
		}
		case 'chain': {
			let pend = null, has = false;
			const off1 = _hSubscribe(spec.src,   target, v => { pend = v; has = true; });
			const off2 = _hSubscribe(spec.other, target, v => { if (has) { const a = pend; has = false; pend = null; cb(spec.fn ? spec.fn(a, v) : [a, v], target); } });
			return () => { off1(); off2(); };
		}
	}
}
const _HANDLE_VERBS = ø({
	on(target, cb)    { return _hSubscribe(this[EVT_HANDLE], target, cb); },
	map(fn)           { return _mkHandle({ kind: 'map',     src: this[EVT_HANDLE], fn }); },
	combine(other, fn){ const o = _specOf(other); return o ? _mkHandle({ kind: 'combine', src: this[EVT_HANDLE], other: o, fn }) : this; },
	sleep(ms)         { return _mkHandle({ kind: 'sleep',   src: this[EVT_HANDLE], ms }); },
	chain(other, fn)  { const o = _specOf(other); return o ? _mkHandle({ kind: 'chain',   src: this[EVT_HANDLE], other: o, fn }) : this; },
});
function _mkHandle(spec, carrier) {
	const h = carrier || ø({});
	defineProperty(h, EVT_HANDLE, { value: spec, configurable: true });
	for (const k of ['on', 'map', 'combine', 'sleep', 'chain'])
		if (!(k in h) || carrier) defineProperty(h, k, { value: _HANDLE_VERBS[k], writable: true, configurable: true, enumerable: false });
	return h;
}

function _makeEventClass(name, type, CTX) {
	const Iface = CTX[_EVT_IFACE(type)] || CTX.Event;
	const carrier = function () {};
	defineProperty(carrier, 'name', { value: name, configurable: true });
	const mint = (init = {}) => { const { target, ...rest } = init; return new Iface(type, { bubbles: true, cancelable: true, composed: true, ...rest }); };
	return new Proxy(carrier, {
		construct(_, args) {
			if (typeof args[0] === 'string') return Reflect.construct(Iface, args); // native signature: passthrough, INERT
			const init = args[0] || {};
			const tgt = init.target || (_EVT_WINDOWISH.has(type) ? CTX : CTX.document);
			const ev = mint(init);
			tgt.dispatchEvent(ev); // creation IS occurrence — converges through the pump
			return ev;             // spent; the outcome is readable
		},
		apply(_, __, args) {
			if (typeof args[0] === 'string') return new Iface(args[0], args[1]);
			const init = args[0] || {};
			return _mkHandle({ kind: 'leaf', type, config: args[0] ? init : null }, mint(init)); // bare call: the inert native, DECORATED into a configured handle
		},
		get(t, prop, r) {
			if (prop === EVT_TYPE || prop === 'type') return type;
			if (prop === EVT_HANDLE) return { kind: 'leaf', type };
			if (prop === 'map' || prop === 'combine' || prop === 'sleep' || prop === 'chain')
				return _HANDLE_VERBS[prop].bind({ [EVT_HANDLE]: { kind: 'leaf', type } }); // class-level derivation — the unconfigured handle
			if (prop === Symbol.hasInstance) return ev => !!ev && ev.type === type && ev instanceof Iface;
			if (prop === 'on') return (target, fn) => _evtSubscribe(target, type, fn);
			return Reflect.get(t, prop, r);
		}
	});
}
const _SUPER  = { on: false, obs: null }; // ⚡⚡ super mode: declarative custom-element upgrades (requires engine mode)
const _NAMESPACES = new Map();
let _I18N = null;
let _fxSeq = 0;
// reportError when available (surfaces as a global `error` event, then returns normally — never throws to its
// caller); pre-2022 fallback rethrows on a fresh task so it still reaches window.onerror.
const _surface = (typeof globalThis !== 'undefined' && typeof globalThis.reportError === 'function') ? (err => globalThis.reportError(err)) : (err => setTimeout(() => { throw err; }, 0));
let _inOn = false;   // suppresses the ':addition' interceptor for our own on() registrations
const MINTED = new WeakMap(); // element → the class it was constructed as (new.target at mint) — the identity the registry and the this-chain answer with; el.constructor is unreliable for plain tag Metas (it resolves native)
const _MINTED_GLOBALS = new Set(); // every global the typeset definer created — the exact unmint list (Pass Q4)
let _ADOPT = null; // active adoption scope: `new Klass()` claims matching pre-populated markup here
let _UPGRADE = null; // one-shot in-place upgrade target — Instance.upgrade(node) parks the live node here; _adoptClaim consumes it before any scope query
const APPS = new Map(); // name → class — strong by design (app registry)
const CUSTOM_TAGS = new Map(); // tag → Instance-extender class — the declarative-upgrade index (auto-fed at rebase; Instance.define(Klass) feeds it explicitly)
const CORE_TAGS = new Set(['async','sync','static','email','tel','website','mailto','logout','reset','portal','intl','router','route','outlet']); // built-in vocabulary — upgraded UNCONDITIONALLY at boot; user tags ride ⚡⚡ super mode
const _ARRAY_MUTATORS = new Set(['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin']);
const _ARRAY_VERBS = new Map(Object.getOwnPropertyNames(Array.prototype)
	.filter(n => typeof Array.prototype[n] === 'function' && n !== 'constructor' && !_ARRAY_MUTATORS.has(n))
	.map(n => [n, function (...a) { return Array.prototype[n].apply(_liveList(this), a); }])); // derived once from Array.prototype; _liveList is a hoisted declaration, so top placement is safe
const BUILT_INS = {
	'fade-in':    { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200, easing: 'ease-out' },
	'fade-out':   { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150, easing: 'ease-in' },
	'slide-up':   { from: { opacity: 0, transform: 'translateY(12px)' },  to: { opacity: 1, transform: 'translateY(0)' }, duration: 250, easing: 'ease-out' },
	'slide-down': { from: { opacity: 0, transform: 'translateY(-12px)' }, to: { opacity: 1, transform: 'translateY(0)' }, duration: 250, easing: 'ease-out' },
	'slide-left': { from: { opacity: 0, transform: 'translateX(12px)' },  to: { opacity: 1, transform: 'translateX(0)' }, duration: 250, easing: 'ease-out' },
	'slide-right':{ from: { opacity: 0, transform: 'translateX(-12px)' }, to: { opacity: 1, transform: 'translateX(0)' }, duration: 250, easing: 'ease-out' },
	'scale-in':   { from: { opacity: 0, transform: 'scale(0.95)' }, to: { opacity: 1, transform: 'scale(1)' },    duration: 200, easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
	'scale-out':  { from: { opacity: 1, transform: 'scale(1)' },    to: { opacity: 0, transform: 'scale(0.95)' }, duration: 150, easing: 'ease-in' },
	'blur-in':    { from: { opacity: 0, filter: 'blur(4px)' }, to: { opacity: 1, filter: 'blur(0px)' }, duration: 250, easing: 'ease-out' },
	'blur-out':   { from: { opacity: 1, filter: 'blur(0px)' }, to: { opacity: 0, filter: 'blur(4px)' }, duration: 200, easing: 'ease-in' },
};

const {
	is, values, getOwnPropertyNames,
	getOwnPropertyDescriptor,
	getPrototypeOf, setPrototypeOf,
	defineProperty, defineProperties,
	keys: objKeys, create: $create,
	hasOwn, keys, entries, getOwnPropertyDescriptor: $ownDesc
} = Object;


/**
* @description Mimics a C-style `#ifndef` check at runtime.
*  Inspects an object and its prototype chain for a property collision. Avoids triggering getters.
*  If the property is missing, `can_define` is executed; otherwise, `can_not_define` is called.
*  NOTE: If an error occurs (e.g., prototype depth limit reached), the error 
*  is logged to the console and the function defaults to `can_not_define`.
* @param {Object} object - The target object to inspect.
* @param {string|symbol} property - The property name or key to check for.
* @param {Function} [can_define = function(){}] - Callback if the property is unique.
* @param {Function} [can_not_define = function(){}] - Callback if the property exists.
* @param {number} [MAX_DEPTH=50] - The maximum depth to search the prototype chain.
* @returns {*} The result of the executed callback.
*/
function ifndef(
	object, property, can_define = function(){}, can_not_define = function(){}, MAX_DEPTH = 50
) {
	try {
		var collision;
		let proto = object;
		let depth = 0;
		while (proto !== null) {
			if (++depth > MAX_DEPTH) throw new RangeError(`Max prototype depth of ${MAX_DEPTH} exceeded.`);
			if (Reflect.getOwnPropertyDescriptor(proto, property)) {
				collision = true;
				break;
			}
			proto = Reflect.getPrototypeOf(proto);
		}
	} catch (e) {
		if (e instanceof RangeError) console.warn('Performance / Security warning: ', e.message);
		else console.warn('Unexpected Error during ifndef check:', e);
		collision = true;
	} finally {
		return (!collision ? can_define : can_not_define).call(object, property, object);
	}
}

function createElement(tag, context) { // TDZ not a problem, createElement isn't run until after
	if (context === 'svg') tag = CAMEL_SVG[tag.toLowerCase()] || tag;
	else tag = tag.toLowerCase();
	if (!context || context === 'html') return doc.createElement(tag);
	return doc.createElementNS(XMLNS[context] || XMLNS.html, tag);
}


const doc = typeof document !== 'undefined' ? document : null;

const kindOf = value => ({}).toString.call(value).slice(8, -1).toLowerCase();
const hasKey = (key, object) => hasOwn(object, key);


/**!
 * @class Interface
 * @license MIT
 * @description: Declarative class-splicing, and the splice itself ──
 * Subclass it and declare members exactly how they should land: statics → the target function,
	methods → target.prototype, descriptors mirrored 1:1 (static method → non-enumerable, static
	field → enumerable, getter → getter). The destination is the constructor arg, or a
	`static [Interface] = Fn` declaration on the subclass. `new Interface(...)` is the one public
	entry; the copy is the private #copy. The source decides the shape: a *class* installs its two
	surfaces (statics + prototype); a plain *object* grafts that object's own members straight onto
	the target — which is how a prototype is decorated onto a live instance.

	`[Interface]` works as a literal computed key via Symbol.toPrimitive: coercing the *base* class
	for a string property key yields a private symbol (the real key), so subclasses never learn the
	raw symbol — they just write `[Interface]`. Any other coercion (a subclass, or a non-string
	hint) returns the default, so `${SomeSubclass}` never throws. (`${Interface}` directly would,
	but that never happens in practice.)
*/
class Interface {

	static #DIRECTIVE = { 'static=>static': true, 'proto=>proto': true }; // bare-target default: mirror both surfaces 1:1
	static #SOURCE		= (() => { /* the default target, as a TDZ-safe thunk */ })();
	static #SYM			= Symbol('Interface');
	static #SKIP 		= new Set(['length', 'name', 'prototype']);
	static #SKIP_PROTO	= new Set(['constructor']);
	static #VERSION		= 0xffac;

	static #copyTo(to, from, skip) {
		for (const k of Reflect.ownKeys(from)) {
			if (!skip.has(k)) Object.defineProperty(to, k, Object.getOwnPropertyDescriptor(from, k));
		}
	}

	static #splice({ target, source, dir = Interface.#DIRECTIVE }) {

		if (!source) throw new TypeError('source must allow properties');
		if (typeof source === 'object') return this.#copyTo(target, source, this.#SKIP_PROTO); // plain object → graft onto target
		if (dir['static=>static']) this.#copyTo(target, source, this.#SKIP);
		if (dir['proto=>static'])  this.#copyTo(target, source.prototype, this.#SKIP_PROTO);
		if (dir['static=>proto'])  this.#copyTo(target.prototype, source, this.#SKIP);
		if (dir['proto=>proto'])   this.#copyTo(target.prototype, source.prototype, this.#SKIP_PROTO);

	}

	static [Symbol.toPrimitive](hint) {
		if (this === Interface) {
			if (hint === 'string') return this.#SYM; // marker symbol
			if (hint === 'number') return this.#VERSION; // version tag
			if (hint === 'default') return this.#SOURCE; // read the registered thunk (optional accessor)
		}
		return Function.prototype.toString.call(this);
	}

	constructor(first, second) {
		if (first === null) return this; // explicit no-splice — super(null): hand back the new.target instance, splice nothing
		const newt = new.target;
		const direct = newt === Interface;

		// setup form — new Interface(() => Target, null): register the default target thunk
		if (direct && typeof first === 'function' && second == null) {
			Interface.#SOURCE = first;
			return Interface;
		}

		// config-object form — { target, 'proto=>proto', 'proto=>static', … }: a directive-driven
		// splice. A bare target keeps the default directives, so existing callers (and a plain-object
		// graft target) are untouched.
		let directives = Interface.#DIRECTIVE;
		let targetArg = first;

		if (first && typeof first === 'object' && 'target' in first) {
			targetArg = first.target; directives = first;
		}

		// default semantics: resolve a target, splice the source(s) onto it
		const target = targetArg ?? (direct ? null : newt[Interface.#SYM]) ?? Interface.#SOURCE?.();
		const sources = direct ? [second] : [];

		if (target == null) throw new Error('[Interface]: no declared or implicit splice target.');
		if (!direct) for (let C = newt; C && C !== Interface; C = Object.getPrototypeOf(C)) sources.push(C);

		for (let n = sources.length; n--; ) {
			const source = sources[n];
			if (source == null || (typeof source !== 'function' && typeof source !== 'object')) {
				throw new Error('[Interface]: no source to splice');
			}
			Interface.#splice({ target, source, dir: directives });
		}
		return target;
	}
}

// --- ES6-DOM Hybrid Interface Table ------------------------------------

class JSDOM extends Interface {
	
	static #_ = (
		s, x, t = (x
			? 'sloppy|strict|literals|constants|cursed|nodejs' 
			: 'stable|baseline|experimental|deprecated|legacy|obsolete'
		).split('|'),
		o = {}
	) => (s
		.matchAll(/(\d):\[([^\]]*)\]\s*/g)
		.forEach(([,i,b]) => o[t[i]] = b ? b.split('|') : []),
		o.all = Object.values(o).flat().sort(), o
	);

	static #__ = s => s.split('|').reduce((a, v) => { a[v.toLowerCase()] = v; return a; }, {});
	static #___ = s => new Set(s.split('|'));

	static ISBADDIE = /^(?:Audio|Error|Image|Map|Math|Object|Option)$/; // 🌹 
	static XMLNSW3C = ø({ math: W3 + '1998/Math/MathML', html: W3 + '1999/xhtml', svg: W3 + '2000/svg' });
	static SUPPORTS = ø({ html: 99.97, svg: 99.84, math: 91.57, '@': '16/3/26' });
	static ELEMENTS = ø({
	  core: this.#_(
		'0:[a|abbr|acronym|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|' +
		'body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|' +
		'details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|' +
		'form|head|header|hgroup|h1|h2|h3|h4|h5|h6|hr|html|i|iframe|img|input|ins|' +
		'kbd|label|legend|li|link|main|map|mark|menu|meta|meter|nav|noscript|' +
		'object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|' +
		'samp|script|section|select|slot|small|source|span|strong|style|sub|' +
		'summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|time|' +
		'title|tr|track|u|ul|var|video|wbr] 1:[search] 2:[fencedframe|geolocation|' +
		'selectedcontent] 3:[basefont|big|center|dir|font|nobr|rb|rtc|strike|tt]' +
		'4:[listing|marquee|noembed|noframes|plaintext|xmp] 5:[applet|blink|frame|' +
		'frameset|isindex|keygen|menuitem|multicol|nextid|param|spacer]'
	  ),
	  math: this.#_(
		'1:[annotation|annotation-xml|math|merror|mfrac|mi|mmultiscripts|mn|mo|mover|' +
		'mpadded|mphantom|mprescripts|mroot|mrow|ms|mspace|msqrt|mstyle|msub|msubsup|msup|' +
		'mtable|mtd|mtext|mtr|munder|munderover|none|semantics] 3:[maction|mfenced] 5:[menclose]'
	  ),
	  svg:  this.#_(
		'0:[a|animate|animateMotion|animateTransform|circle|clipPath|defs|desc|ellipse|' +
		'feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|' +
		'feDiffuseLighting|feDisplacementMap|feDistantLight|feDropShadow|feFlood|' +
		'feFuncA|feFuncB|feFuncG|feFuncR|feGaussianBlur|feImage|feMerge|feMergeNode|' +
		'feMorphology|feOffset|fePointLight|feSpecularLighting|feSpotLight|feTile|' +
		'feTurbulence|filter|foreignObject|g|image|line|linearGradient|marker|mask|' +
		'metadata|mpath|path|pattern|polygon|polyline|radialGradient|rect|set|stop|' +
		'style|svg|switch|symbol|text|textPath|title|tspan|use|view]'
	  )
	});

	static KEYWORDS = this.#_(
		'0:[break|case|catch|class|const|continue|debugger|default|delete|do|' +
		'else|export|extends|finally|for|function|if|import|in|instanceof|' +
		'new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield]' +
		'1:[arguments|enum|eval|implements|interface|let|package|private|protected|' +
		'public|static] 2:[false|null|true] 3:[undefined|NaN|Infinity] 4:[async|await|' +
		'defer|get|set] 5:[__dirname|__filename|exports|global|module|process|require]', 1 // 1: x is true
	);

	static DICTIONS = ø({
		Pascalite: this.#__(
			'BDI|HTML|TBody|BDO|IFrame|TD|BR|KBD|TFoot|DD|LI|TH|DFN|OL|THead|DL|RB|' +
			'TR|DT|RP|TT|RT|UL|HGroup|RTC|WBR|SVG|XMP|HR'
		),
		Pascal: this.#__(
			'BaseFont|KeyGen|BlockQuote|MenuItem|ColGroup|NoFrames|DataList|NoScript|FencedFrame|OptGroup|' +
			'FieldSet|SelectedContent|FigCaption|TBody|FrameSet|TextArea|HGroup|TFoot|IFrame|THead'
		)
	});

	static TYPESETS = this.#___('initial|jquery|pascal|pascalite|uppercase|none');
	static ACRONYMS = this.#___('LI|UL|OL|DL|DT|DD|TD|TH|TR|TT|HR|BR|BDI|BDO|DFN|KBD|SVG|WBR|XMP|HTML|RB|RP|RT|RTC');
	
	static SYMBOLS = new Set([
		'UID', 'MOUNTED', 'ELEMENTS','METADATA', 'PROTO', 'SHADOW_ROOT', 'PENDING_ARGS',
		'SCOPED_STYLES_INJECTED', 'DESTROYING', 'PATCHED_EVENTS', 'FORM_STATE', 'MOUNT',
		'UNMOUNT', 'CONTEXT', 'PROXIES', 'REACTIVE_PROXY', 'REACTIVE_CHAIN', 'WORKER_PROXY', 
		'SOCKET_PROXY', 'LISTEN_PROXY', 'LAST_PARENT', 'LAST_SIBLING', 'PLACEMENT', 'LEAF'
	]);

	static LAZY_SYMBOLS = new Set([ // WeakMap getOrInsertComputed => new Map() || new Set()
		'OBSERVERS', 'LIFECYCLE', 'ACTIVE_TRANSITIONS', 'META_TRANSITION_HANDLERS',
		'ELEMENT_NS_STORE', 'INBOUND_HANDLERS', 'DELEGATES','NAMED_LISTENERS'
	]);

}

	/**
	 * Internal Symbol Configuration
	 * Mapping Symbol Keys to their Property Descriptor Factories
	 */

	const BEHAVIORS = ø({
		// 1. THE BITMASK (Ultra-fast boolean flags)
		STATUS: (store) => ø({
			get() { return store.get(this) ?? 0; },
			set(v) { store.set(this, v); }
		}),

		// 2. THE WEAKSET (Existence-based state)
		MOUNTED: (store) => ø({
			get() { return store.has(this); },
			set(v) { v ? store.add(this) : store.delete(this); }
		}),

		// 3. THE ATOMIC MERGE (Metadata lookups)
		CONTEXT: (store) => ø({
			get() {
				return store.getOrInsertComputed(this, () => ({ insertion: null, removal: null }));
			},
			set(v) {
				const current = store.getOrInsertComputed(this, () => ({ insertion: null, removal: null }));
				store.set(this, { ...current, ...v });
			}
		}),

		// 4. THE LOW LEVEL PROXIES (WebSocket, PostMessage, WebWorker)
		PROXIES: (store) => ø({
			value(type, factory) {
				const registry = store.getOrInsertComputed(this, () => new Map());
				if (type === TEARDOWN) { // the drain command (Pass Q4): dispose calls this — terminate workers, close sockets, unlisten
					for (const v of registry.values()) { try { v && v.remove && v.remove(); } catch (e) {} }
					registry.clear();
					return;
				}
				return factory
					? registry.getOrInsertComputed(type, () => factory.call(this))
					: registry.get(type);
			},
			writable: false, configurable: true, enumerable: false
		}),

		MOUNT: (store) => ø({
			value(Klass) {
				switch (typeof this) {
					case 'object': {
						this[METADATA] = {
							constructor: Klass,
							native: Klass.native ?? null
						};
						this[ELEMENTS] = [this];

						// ── Shadow DOM ────────────────────────────────
						const shadowConfig = parseShadowStatic(Klass.shadow);
						if (shadowConfig) {
							const root = this.attachShadow({ mode: shadowConfig.mode });
							this[SHADOW_ROOT] = root;
							_injectShadowAssets(this, root, Klass);
							if (Klass.template) {
								const tmpl = document.createElement('template');
								tmpl.innerHTML = Klass.template;
								root.appendChild(tmpl.content.cloneNode(true));
							}
							if (keys(shadowConfig.parts).length)
								_applyParts(root, shadowConfig.parts);
						}

						// ── Inbound events ────────────────────────────
						const events = parseEventsStatic(Klass);
						if (keys(events).length) {
							wireInboundEvents(this, events);
							if (shadowConfig)
								def(this, 'trigger', {
									value: makeShadowTrigger(this, events),
									configurable: true,
									enumerable: false,
									writable: true
								});
						}

						return shadowConfig;
					}
					case 'function': {
						return;
					}
				}
			},
			writable: false, configurable: true, enumerable: false
		}),

		UNMOUNT: (store) => ø({
			value(ctx) {
				switch (typeof this) {
					case 'object': {
						const handlers = this[INBOUND_HANDLERS];
						if (handlers) {
							handlers.forEach((handler, name) => this.removeEventListener(name, handler));
							handlers.clear();
						}
						let Ctor = this[METADATA]?.constructor;
						while (Ctor && Ctor !== Function.prototype) {
							if (typeof Ctor === 'function' && owns(ELEMENTS, Ctor)) {
								const reg = Ctor[ELEMENTS];
								const idx = reg.indexOf(this);
								if (idx !== -1) reg.splice(idx, 1);
							}
							Ctor = getPrototypeOf(Ctor);
						}
						const effects = this[EFFECTS];

						effects?.forEach(d => d());
						effects?.clear();

						values(STORE).forEach(m => m.delete(this));
						return;
					}
				}
			}
		})
	});


	/* Symbols: the element's entire symbol-keyed surface in ONE install — the compiler hooks
	 *  (INSTANCE family, EFFECTS), the minted off-element state accessors (the unrolled loop over
	 *  JSDOM.SYMBOLS / LAZY_SYMBOLS, WeakMap/WeakSet-backed), and the JS well-known surface. Every
	 *  well-known body dispatches on typeof this (function = the class, object = the element), so one
	 *  definition serves both faces — spliced proto=>proto + proto=>static. Replaces the former
	 *  Construct + WellKnownSymbols + Symlink trio. */

	class Symbols extends JSDOM {

		static {

			const ISSET = /^(?:ACTIVE_TRANSITIONS)$/;
			const SYMBOLS = this.SYMBOLS, LAZY_SYMBOLS = this.LAZY_SYMBOLS;

			for (const key of [...SYMBOLS, ...LAZY_SYMBOLS]) {

				const Ctor = ISSET.test(key) ? Set : Map;

				const sym = (this[key] = Symbol(`Instance:${key.toLowerCase().replace(/_/g, '.')}`));

				/* THE MINT — the one place an element-keyed weak store is born.
				 * MOUNTED is existence-based (WeakSet); everything else keys a value. */
				const store = key === 'MOUNTED' ? new WeakSet() : new WeakMap();
				if (key === 'ACTIVE_TRANSITIONS') ACTIVE_TR = store; // hot alias — transition dedupe reads it directly

				const logic = ((preset, lazy) => preset || (lazy
					? store => ø({
						get()  { return store.getOrInsertComputed(this, () => new Ctor()) },
						set(v) { return v } // gaslight setter
					}) 
					: store => ø({
						get()  { return store.get(this) ?? null },
						set(v) { store.set(this, v) }
					})
				))(BEHAVIORS[key], LAZY_SYMBOLS.has(key))(store);

				const desc = ø({ configurable: true, enumerable: false });

				if ('value' in logic) {
					desc.value = logic.value;
					desc.writable = logic.writable ?? false;
				} else {
					desc.get = logic.get;
					desc.set = logic.set;
				}

				Object.defineProperty(this, sym, desc);
				Object.defineProperty(this.prototype, sym, desc);
			}

			/* ── the pass-state tables (D through N) — SAME mint, SAME accessor pattern.
			 * Each entry: [aliasAssign, symbolName, kind]. kind drives both the store
			 * ctor and the accessor preset:
			 *   'exists'  → WeakSet; accessor get = membership, set true/false = add/delete
			 *   'lazyMap' → WeakMap; accessor get = getOrInsert new Map (per-element table)
			 *   'lazySet' → WeakMap; accessor get = getOrInsert new Set
			 *   'plain'   → WeakMap; accessor get/set = raw value
			 * The alias functions assign the module-level hot-path bindings declared at
			 * the top of the file — see the ELEMENT-KEYED WEAK STATE banner. */
			for (const [assign, name, kind] of [
				[s => ARMED = s,            'ARMED',             'exists' ],
				[s => STORE = s,            'STORE',             'plain'  ],
				[s => AWAITING = s,         'AWAITING',          'plain'  ],
				[s => CONSTRUCTS = s,       'CONSTRUCTS',        'plain'  ],
				[s => EFFECT_NAMES = s,     'EFFECT_NAMES',      'plain'  ],
				[s => LC_LISTENERS = s,     'LC_LISTENERS',      'lazyMap'],
				[s => _EV = s,              'EV',                'lazyMap'],
				[s => _SUBS = s,            'SUBS',              'lazySet'],
				[s => _NS_CACHE = s,        'NS_CACHE',          'plain'  ],
				[s => _NS_CLEAN = s,        'NS_CLEAN',          'lazySet'],
				[s => LC_MOUNTED = s,       'LC_MOUNTED',        'exists' ],
				[s => LC_DETACHED = s,      'LC_DETACHED',       'exists' ],
				[s => LC_HANDLED_EXIT = s,  'LC_HANDLED_EXIT',   'exists' ],
				[s => LC_HANDLED_ENTER = s, 'LC_HANDLED_ENTER',  'exists' ],
				[s => CLAIMED = s,          'CLAIMED',           'exists' ]
			]) {
				const store = kind === 'exists' ? new WeakSet() : new WeakMap();
				assign(store);
				const sym = (this[name] = Symbol(`Instance:${name.toLowerCase().replace(/_/g, '.')}`));
				const logic =
					kind === 'exists'  ? ø({ get() { return store.has(this); }, set(v) { v ? store.add(this) : store.delete(this); } })
					: kind === 'lazyMap' ? ø({ get() { return store.getOrInsertComputed(this, () => new Map()); }, set(v) { return v; } })
					: kind === 'lazySet' ? ø({ get() { return store.getOrInsertComputed(this, () => new Set()); }, set(v) { return v; } })
					:                      ø({ get() { return store.get(this) ?? null; }, set(v) { store.set(this, v); } });
				const desc = ø({ configurable: true, enumerable: false, get: logic.get, set: logic.set });
				Object.defineProperty(this, sym, desc);
				Object.defineProperty(this.prototype, sym, desc);
			}
		}

		[INSTANCE](Level, snapshotFn, settleFn, manifest) {
			return instanceHook(this, Level, snapshotFn, settleFn, 'cap', manifest);
		}

		[INSTANCE_MIXED](Level, snapshotFn, settleFn, manifest) {
			return instanceHook(this, Level, snapshotFn, settleFn, 'forward', manifest);
		}

		[INSTANCE_ASYNC](Level, snapshotFn, settleFn, manifest) {
			return instanceHook(this, Level, snapshotFn, settleFn, 'take', manifest);
		}

		[EFFECTS]() { return effectDescriptors(this); } // descriptor provider — see armEffects (§effects)
	}



	/*  
	 *	WellKnownSymbols: the JS well-known protocol surface, layered onto Symbols (extends it).
	 *  Inherits the off-element mint + the compiler hooks; adds toStringTag / iterator / toPrimitive /
	 *  hasInstance + the string-protocol stubs (split/search/replace/match/matchAll — kept as
 *  stubs by design; the empty species/dispose/asyncDispose/asyncIterator/unscopables
 *  stubs were pruned in Pass O: nothing consumed them, and class-level species is pinned
 *  on Instance itself). Installing this leaf walks WellKnownSymbols -> Symbols -> JSDOM,
	 *  splicing the whole stack onto Instance.
	 */
	class WellKnownSymbols extends Symbols {

		get [Symbol.toStringTag]() {
			switch (typeof this) {
				case 'function': { return (this.id ?? 'Anonymous') + ' Class'; }
				case 'object': {
					const md = this[METADATA];
					return md
						? (md.constructor?.id ?? md.constructor?.name ?? this.tagName?.toLowerCase() ?? '')
						: (this.tagName?.toLowerCase() ?? '');
				}
			}
		}


		[Symbol.isConcatSpreadable]() {
			return true;
		}

		/* ── the disposal protocol (Pass Q4) — house analog of Symbol.dispose / Symbol.asyncDispose,
		 * living where the well-knowns live. One body, every face, dispatched on `typeof this`:
		 *   element[TEARDOWN]()        → dispose the element (detach + reclaim; proxies drain in the sweep)
		 *   Class[TEARDOWN]()          → the static face wins via the relay (registry self-destruct) — this
		 *                                prototype branch is the safety net if a class ever reaches it
		 * Symbol.dispose / Symbol.asyncDispose alias onto these below, so `using el = new Div()` works. */
		[TEARDOWN](unmint) {
			return typeof this === 'function' ? Instance[TEARDOWN].call(this, unmint) : this.remove(true);
		}
		[TEARDOWN_ASYNC](unmint) {
			return typeof this === 'function' ? Instance[TEARDOWN_ASYNC].call(this, unmint) : Lifecycle.disposeAsync(this);
		}
		[Symbol.dispose ?? Symbol.for('Instance.dispose.shim')]() { return this[TEARDOWN](); }             // `using el = …` works where the platform has it
		[Symbol.asyncDispose ?? Symbol.for('Instance.asyncDispose.shim')]() { return this[TEARDOWN_ASYNC](); } // `await using el = …`
		
		[Symbol.toPrimitive](hint) {
			switch (typeof this) {
				case 'object': {
					if (hint === 'string') {
						const md = this[METADATA];
						return md
							? (md.constructor?.id ?? md.constructor?.name ?? this.tagName?.toLowerCase() ?? '')
							: (this.tagName?.toLowerCase() ?? '');
					}
					if (hint === 'number') {
						const col = this[ELEMENTS];
						return col ? col.indexOf(this) : 0;
					}
					return this;
				}
				case 'function': {
					if (hint === 'string') return this.id ?? this.name ?? 'anonymous';
					if (hint === 'number') return this[ELEMENTS]?.length ?? 0;
					return this;
				}
			}
		}

		[Symbol.hasInstance](value) {
			return Function.prototype[Symbol.hasInstance].call(this, value);
		}

		/* ── the string protocol (Pass Q8b·search) — `query.search(el)` dispatches to
		 *    el[Symbol.search](query): the ELEMENT is the pattern, the query is the haystack.
		 *    Receiver-split by typeof this — a CLASS searches its live [ELEMENTS] collection
		 *    and returns a REGISTRY INDEX (pairs with Class[n]); an ELEMENT searches its own
		 *    text. The search engine is these five bodies. ── */
		/* ── the string protocol (Pass Q8b·search) — INTENTIONALLY Instance-semantic ──
		 *  `query.method(receiver)` → receiver[Symbol.method](query): the receiver is the
		 *  PATTERN, the query is the haystack. We diverge from RegExp on purpose because
		 *  the collection behavior is too useful to give up: query a class as if it were a
		 *  regex and it answers with its LIVING INSTANCES. Receiver nature splits meaning:
		 *    ELEMENT (text container) → the query tests THIS element's text
		 *    CLASS   (live collection) → the query tests EVERY instance in [ELEMENTS]
		 *  The five verbs, as collection operations:
		 *    search=predicate(Number) · match=filter(Collection) · matchAll=walker(lazy)
		 *    replace=mutator(writes DOM text) · split=partitioner([hits,misses])
		 *  All PURE except replace (the verb IS mutation). No hidden highlighting. */
		get flags() { return 'gi'; }                 // matchAll reads .flags before dispatch — must exist
		get global() { return true; }

		[Symbol.search](query) { // PREDICATE — engine locks return to Number; we make the Number meaningful
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → registry index of the first matching instance (round-trips: Class[n])
				const reg = this[ELEMENTS]; if (!reg) return -1;
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) return i; }
				return -1;
			}
			let h = ''; try { h = (this.textContent || '').toLowerCase(); } catch (e) {} // ELEMENT → char offset of query in this text
			return q ? h.indexOf(q) : -1;
		}

		[Symbol.match](query) { // FILTER — the matching ELEMENTS (a live Collection), not text
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → a Collection of matching instances (indexable, .where-able, live)
				const reg = this[ELEMENTS] || []; const out = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) out.push(reg[i]); }
				return Instance.from ? Instance.from(out) : out;
			}
			let h = ''; try { h = (this.textContent || '').toLowerCase(); } catch (e) {} // ELEMENT → this element if it matches (a self-test), else null
			return (q && h.indexOf(q) !== -1) ? this : null;
		}

		*[Symbol.matchAll](query) { // WALKER — lazy; yields per match with detail
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → each matching {element, index} (element + its registry slot)
				const reg = this[ELEMENTS] || [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (q && t.indexOf(q) !== -1) yield { element: reg[i], index: i, input: query }; }
				return;
			}
			if (!q) return; // ELEMENT → each {text, index} occurrence in this element's content
			let text = ''; try { text = this.textContent || ''; } catch (e) {} const h = text.toLowerCase();
			let from = 0, at; while ((at = h.indexOf(q, from)) !== -1) { yield { text: text.slice(at, at + q.length), index: at, input: text }; from = at + q.length; }
		}

		[Symbol.replace](query, replacement) { // MUTATOR — the one verb that writes: swaps matched TEXT in the live DOM
			const q = String(query == null ? '' : query);
			const ql = q.toLowerCase();
			const swap = (el) => { // replace matched text within one element's textContent
				let text = ''; try { text = el.textContent || ''; } catch (e) { return; }
				if (!q) return;
				const low = text.toLowerCase(); let res = '', from = 0, at;
				while ((at = low.indexOf(ql, from)) !== -1) { const seg = text.slice(at, at + q.length); res += text.slice(from, at) + (typeof replacement === 'function' ? replacement(seg, el) : String(replacement)); from = at + q.length; }
				if (from > 0) { try { el.textContent = res + text.slice(from); } catch (e) {} }
			};
			if (typeof this === 'function') { // CLASS → mutate every matching instance; return the Collection (chainable)
				const reg = this[ELEMENTS] || []; const hit = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} if (ql && t.indexOf(ql) !== -1) { hit.push(reg[i]); swap(reg[i]); } }
				return Instance.from ? Instance.from(hit) : hit;
			}
			swap(this); return this; // ELEMENT → mutate this element's text; return the element (chainable)
		}

		[Symbol.split](query) { // PARTITIONER — two buckets
			const q = String(query == null ? '' : query).toLowerCase();
			if (typeof this === 'function') { // CLASS → [matching, nonmatching] instances
				const reg = this[ELEMENTS] || []; const hit = [], miss = [];
				for (let i = 0; i < reg.length; i++) { let t = ''; try { t = (reg[i].textContent || '').toLowerCase(); } catch (e) {} (q && t.indexOf(q) !== -1 ? hit : miss).push(reg[i]); }
				return Instance.from ? [Instance.from(hit), Instance.from(miss)] : [hit, miss];
			}
			let text = ''; try { text = this.textContent || ''; } catch (e) {} if (!q) return [text]; // ELEMENT → [before, after] around the FIRST match
			const low = text.toLowerCase(); const at = low.indexOf(q);
			return at === -1 ? [text] : [text.slice(0, at), text.slice(at + q.length)];
		}


		*[Symbol.iterator]() {
			const all = this[ELEMENTS];
			if (all) for (let i = 0; i < all.length; ) yield all[i++];
		}


	}

	// Symbol getters / setters (EFFECTS is the const hook above; REACTIVE_STORE stays Chimera's)
	const {
		UID, METADATA,
		REACTIVE_CHAIN,
		MOUNTED, ELEMENTS,
		OBSERVERS, PATCHED_EVENTS,
		REACTIVE_PROXY, LIFECYCLE,
		PROTO, SHADOW_ROOT,
		PENDING_ARGS, SCOPED_STYLES_INJECTED,
		WORKER_PROXY, SOCKET_PROXY, LISTEN_PROXY,
		FORM_STATE, PROXIES, // the callable-interface store binding (Pass Q4 — the '-> PROXIES' note, honored)
		LAST_PARENT, LAST_SIBLING,
		PLACEMENT, DESTROYING,
		ACTIVE_TRANSITIONS,
		META_TRANSITION_HANDLERS,
		ELEMENT_NS_STORE,
		INBOUND_HANDLERS,
		DELEGATES,
		MOUNT, UNMOUNT,
		NAMED_LISTENERS,
		LEAF // per-element leaf class — now a minted loop slot (was hand-wired off-element)
	} = Symbols;

	/*
	* §4 — script self-parser (reads autoclass / typeset / engine off <script>)
	*/
	class AttributeParser extends JSDOM {

		constructor(el, defaults) {
			super(null);
			return !el || !defaults ? this : this.parse(el, defaults);
		}

		static #SHORTHANDS = {
			core:		   'core.stable',
			stable:		   'core.stable',
			baseline:	   'core.baseline',
			experimental:  'core.experimental',
			deprecated:	   'core.deprecated',
			legacy:		   'core.legacy',
			obsolete:	   'core.obsolete'
		};

		static normalizeAttribute(attribute, element) {
			if (!(element && element.getAttribute) || typeof attribute !== 'string') return [];
			const dataKey = attribute.startsWith('data-') ? attribute : 'data-' + attribute;
			const bareKey = attribute.startsWith('data-') ? attribute.slice(5) : attribute;
			const read = k => (element.getAttribute(k) ?? '').normalize('NFC').toLowerCase();
			const split = raw => raw.split(/[\s,|]+/).map(token => token.trim()).filter(Boolean);
			return [...new Set([...split(read(dataKey)), ...split(read(bareKey))])];
		}

		static autoclass(script) {

			const ELEMENTS = this.ELEMENTS;
			const SHORTHANDS = this.#SHORTHANDS;
			const result = { core: [], math: [], svg: [] };
			const known = {
				core: new Set(ELEMENTS.core.all), 
				math: new Set(ELEMENTS.math.all), 
				svg:  new Set(ELEMENTS.svg.all)
			};

			const expand = (ns, bucket) => ELEMENTS[ns][bucket] || [];

			for (const token of this.normalizeAttribute('autoclass', script)) {
				if (token.includes('.')) {

					const dot = token.indexOf('.');
					const ns = token.slice(0, dot);
					const bucket = token.slice(dot + 1);

					if (!hasKey(ns, result)) continue;

					result[ns].push(
					...(hasKey(bucket, ELEMENTS[ns])
							? expand(ns, bucket) : known[ns].has(bucket)
								? [bucket] : []
						)
					);

					continue;
				}
				if (hasKey(token, SHORTHANDS)) {
					const [ns, bucket] = SHORTHANDS[token].split('.');
					result[ns].push(...expand(ns, bucket));
					continue;
				}
				if (known.core.has(token)) {
					result.core.push(token);
					continue;
				}
			}
			keys(result).forEach(ns => (result[ns] = [...new Set(result[ns])].sort()));

			if (!keys(result).some(ns => result[ns].length)) {
				result.core = expand('core', 'stable').slice();
			}

			return {
				core: new Set(result.core), math: new Set(result.math), svg: new Set(result.svg)
			};
		}

		sanitize(el, key, allowed) {
			const attr = (el?.getAttribute('data-' + key) ?? el?.getAttribute(key) ?? '')
				.normalize('NFC').toLowerCase().trim();
			const result = attr ? [...new Set(attr.split(/\s*,\s*/).filter(Boolean))] : [];
			return Array.isArray(allowed) ? result.filter(s => allowed.includes(s)) : result;
		}

		static types(script) {
			return Array.from(script?.attributes ?? []).flatMap(({ name, value }) => {
				const ln = name.toLowerCase();
				const base = ln.startsWith('data-')
					? ln.slice(5)
					: ln.startsWith('@')
						? ln.slice(1)
						: ln;
				const isTypeset = base === 'typeset';
				if (!isTypeset && !this.TYPESETS.has(base)) return [];
				return [isTypeset ? value : value ? base + '=' + value : base];
			}).join(', ');
		}

		static typeset(input, whitelist = this.TYPESETS) {
			const raw =
				typeof input === 'string'
					? input
					: input && input.attributes
						? this.types(input)
						: '';
			const seen = new Set();
			const list = whitelist && new Set(whitelist);
			const array = raw.split(',').flatMap(segment => {
				let [key, ...rest] = segment.split('=').map(s => s.trim().normalize('NFC'));
				if (!key) return [];
				key = key.toLowerCase();
				const value = rest.join('=') || null;
				const id = key + '|' + value;
				return (!list || list.has(key)) && !seen.has(id)
					? (seen.add(id), { key, value }) : [];
			});
			return array.length ? array : [{ key: 'pascalite', value: null }];
		}

		parse(el, defaults) {
			const settings = {};
			for (const [key, value] of entries(defaults)) {
				switch (kindOf(value)) {
					case 'function': {
						if (!value.length) settings[key] = this.constructor[key].call(this.constructor, el);
						else settings[key] = value.call(el, el);
						break;
					}
					case 'object': {
						let [primary, alternatives] = entries(value)[0];
						let result = this.sanitize(el, key, [primary, ...alternatives]);
						settings[key] = result.length ? result : [primary];
						break;
					}
					case 'boolean': {
						settings[key] = value;
						break;
					}
					default: {
						settings[key] = value === !!value
							? !!(el?.hasAttribute('data-' + key) || el?.hasAttribute(key))
							: value;
					}
				}
			}
			settings.attributes = el?.attributes;
			settings.defaults = defaults;
			settings.script = [el];
			return Object.freeze(settings);
		}

		static engine(element) {
			return !!(
				element &&
				(element.hasAttribute('⚡') ||
					element.hasAttribute('data-engine') ||
					element.hasAttribute('engine'))
			);
		}

		static super(element) {
			// ⚡⚡ boot — mirrors engine(); the #initialize schema dispatches `super: () => {}`
			// here by name (parse → this.constructor['super']). Without this static the boot
			// crashes the instant document.currentScript is a real <script src> (i.e. any real
			// browser); Node/jsdom-injected scripts have a null currentScript and never reach it.
			return !!(
				element &&
				(element.hasAttribute('⚡⚡') ||
					element.hasAttribute('data-super') ||
					element.hasAttribute('super'))
			);
		}
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §3 — Lexeme: identity-preserving naming transforms (tag → ClassName)
	* ════════════════════════════════════════════════════════════════════════ */

	class Lexeme extends String {

		static #TYPESETS = JSDOM.TYPESETS;
		static #DICTIONS = JSDOM.DICTIONS;

		constructor(text, convention = 'pascalite', id, alreadyTransformed) {
			super(text);
			convention = Lexeme.#TYPESETS.has(convention) ? convention : 'pascalite';
			defineProperty(this, 'id', { value: id ?? text.toUpperCase(), enumerable: true });
			defineProperty(this, 'original', { value: text, enumerable: true });
			defineProperty(this, 'convention', { value: convention, enumerable: true });
			return alreadyTransformed
				? this : convention === 'none'
					? this : this[convention]();
		}

		#lookup(convention, fallback) {
			const dictionary = Lexeme.#DICTIONS?.[convention];
			const key = this.toLowerCase();
			const entry = dictionary && hasOwn(dictionary, key) ? dictionary[key] : void 0;
			return this.#derive(entry ?? String(fallback));
		}
		#derive(value) { return new Lexeme(String(value), this.convention, this.id, true); }

		alias(convention) { return new Lexeme(this.original, convention, this.id); }
		suffixize(regex, str) { return regex.test(this) ? this.#derive(this + str) : this; }
		prefix(str) { return str ? this.#derive(str + this) : this; }
		initial() { return this.length
			? this.#derive(this[0].toUpperCase() + this.slice(1).toLowerCase())
			: this;
		}
		pascalite() { return this.#lookup('Pascalite', this.initial()); }
		uppercase() { return this.#derive(super.toUpperCase()); }
		pascal() { return this.#lookup('Pascal', this.pascalite()); }
		jquery() { return this.#derive('$' + this.initial()); }
		none() { return this; }
	}


		// ── DSL — Selector & Placement Parser ─────────────────────────────────
	//
	//   DSL.parse(string)               → AST
	//   DSL.targets(ast, root?)         → [...domElements]  pure query
	//   DSL.place(ast, element, target) → one element into one target
	//   DSL.route(ast, element, root?)  → convenience, single element
	//   DSL.pipe(string, element, root?)→ parse + route combined
	//
	/* ════════════════════════════════════════════════════════════════════════
	* §4.6 — DSL: selector & placement parser (inlined; identical to dsl-core.js
	*   and the DSL test suite). Wired into the element constructor below: a string
	*   arg led by '@' is a placement directive ("@#target", "@before .x",
	*   "@first child of #list", …) that routes the element to a target; non-'@'
	*   strings keep their existing meaning. Author handle: Instance.DSL.
	* ════════════════════════════════════════════════════════════════════════ */
	// DSL (selector & placement grammar) is now the DSL-v8 plugin — bound from build.DSL above.
	

	// TODO: update regex markers to accept unicode.
	// TODO: ensure WeakMap entries do not fail when DOM elements are added and removed.

	const XMLNS = JSDOM.XMLNSW3C;
	/* svg tags whose canonical DOM name is camelCased (createElementNS is case-sensitive) */
	const CAMEL_SVG = JSDOM.ELEMENTS.svg.all.reduce(
		(map, tag) => (/[A-Z]/.test(tag) && (map[tag.toLowerCase()] = tag), map), ø()
	);

	// Kernel field-proxy + accessor math for V17
	const isAcc = p => typeof p === 'string' && /^(?:\${1,3}|Δ{1,3}|@|ø|ψ)$/.test(p);
	const isRK  = p => typeof p === 'string' && /^[$Δ@ø]/.test(p) && !isAcc(p);

	const fieldGet = (element, key) => element[key]; // reads route through the spliced proxy
	const fieldSet = (element, key, value) => { element[key] = value; };
	const hasField = (element, key) => {
		const s = STORE.get(element);
		return !!s && s.dict.has(key);
	};

	const SIGIL_SUFFIX = /[A-Za-z0-9_]([$Δ]{1,3})$/; // an effect method: name ends in a sigil run
	const isUnionSigil = sigil => sigil.includes('Δ');

	/* effects: name$() / nameΔ() methods become Chimera effects, armed once at the
		* leaf so the first read already sees the snapshot (consensus lands once, no
		* flash). The trailing sigil picks the gate: $ → consensus, Δ → union. */

	function effectsOf(leafClass) {
		let list = EFFECT_NAMES.get(leafClass);
		if (list) return list;
		const protos = [], seen = new Set(['constructor']);
		for (let proto = leafClass.prototype; 
			proto && proto !== Object.prototype; 
			proto = getPrototypeOf(proto)
		) {
			protos.unshift(proto);
		}
		list = [];
		for (const proto of protos)
			for (const name of Object.getOwnPropertyNames(proto)) {
				if (seen.has(name)) continue;
				const match = SIGIL_SUFFIX.exec(name);
				if (match && typeof proto[name] === 'function') {
					seen.add(name);
					list.push({ name, union: isUnionSigil(match[1]) });
				}
			}
		EFFECT_NAMES.set(leafClass, list);
		return list;
	}
	/*
	question: when elements are detached but not removed, or if native element prototype remove is called on them, 
	what happens to the weakmap entry?
	*/
	/* [EFFECTS] hook contract (0.87.6): returns an ORDERED array of descriptors
	 *   { at: 'new' | 'mount' | '@lifecycle' | '<event-name>', fn?, name?, union? }
	 * 'new'          → minted immediately at leaf construction (the historical behavior)
	 * 'mount'/'@…'   → minted when that lifecycle key first fires ('@mount' is once-ever)
	 * anything else  → minted on the FIRST DOM event of that (normalized) type on the element
	 * Body: fn.call(element, element) when fn is given, else element[name]().
	 * Once minted, each is a live Chimera effect (re-runs on dependency change) until dispose.
	 * The default hook maps suffix methods name$/nameΔ to { at:'new', name, union } —
	 * the trailing sigil sets the gate: $ → consensus (AND), Δ → union (OR). Override
	 * [EFFECTS]() to supply a custom list (extend via super[EFFECTS]()). */
	function effectDescriptors(element) {
		return effectsOf(element[LEAF]).map(({ name, union }) => ({ at: 'new', name, union }));
	}

	function mintEffect(element, d, i) {
		const store = STORE.get(element);
		const body = typeof d.fn === 'function' ? () => d.fn.call(element, element) : () => element[d.name]();
		const effectNode = new Signal.Effect(body, { union: !!d.union });
		store.dict.set(`${d.name ?? d.at + ':' + i}$$effect`, effectNode.ref); // parked under a reserved suffix
	}

	function armEffects(element) {
		if (ARMED.has(element)) return element;
		ARMED.add(element);
		const list = typeof element[EFFECTS] === 'function' ? element[EFFECTS]() : element[EFFECTS];
		if (!Array.isArray(list)) return element;
		list.forEach((d, i) => {
			if (!d || (typeof d.fn !== 'function' && typeof element[d.name] !== 'function')) return;
			const at = d.at ?? 'new';
			if (at === 'new') return mintEffect(element, d, i);
			let done = false;
			const arm = () => { if (done) return; done = true; mintEffect(element, d, i); };
			const lc = at[0] === '@' ? at : (at === 'mount' || at === 'unmount' || at === 'reattach' || at === 'removal' ? '@' + at : null);
			if (lc) _lcAdd(element, lc, arm);
			else element.addEventListener(_normEvent(at), arm, { once: true });
		});
		return element;
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §5 — THE CONSTRUCTION MODEL: the [INSTANCE] hook handler
	*   Runs once per level on the shared element, parent before child. Reads the
	*   parent's settlement off the element, feeds `_super_` per super-mode, settles
	*   its own fields, and republishes the chain for the child and for `await new`.
	* ════════════════════════════════════════════════════════════════════════ */
	function poisonPending(element, manifest) {
		if (manifest)
			for (const key of manifest)
				if (fieldGet(element, key) === PENDING) fieldSet(element, key, POISONED);
	}
	function bindThenable(element, settleChain) {
		AWAITING.set(element, settleChain); // off-element: the metaclass proxy serves a virtual `then` while awaiting
	}

	function thenFor(element) {
		// virtual `then`; delete BEFORE resolving so `await el` does not re-enter el.then
		return (onFulfilled, onRejected) =>
			AWAITING.get(element)
				.then(
					() => { AWAITING.delete(element); return element; },
					(error) => { AWAITING.delete(element); throw error; }
				)
				.then(onFulfilled, onRejected);
	}

	function instanceHook(element, Level, snapshotFn, settleFn, superMode, manifest) {

		let state = CONSTRUCTS.get(element);
		if (!state) CONSTRUCTS.set(element, (state = { parentChain: Promise.resolve(), levels: [] }));

		const parentChain = state.parentChain;

		/* 1. manifest fields begin as ?? */
		if (manifest)
			for (const key of manifest)
				if (!hasField(element, key)) fieldSet(element, key, PENDING);

		/* 2. snapshot — the sync prefix lands now */
		if (snapshotFn) snapshotFn.call(element);

		/* 2b. arm reactive effects once, at the leaf (its hook runs last) so the read
			*     is the subscription and effects re-run as ?? fields settle */
		if (Level === element[LEAF]) armEffects(element);

		/* 3. settlement — feed `_super_`:
			*      take    → the parent's chain (compiled `await _super_` really waits)
			*      forward → already-resolved (own settles eagerly; parent added below)
			*      cap     → unused (no `await _super_` emitted) */
		const superInput = superMode === 'take' ? parentChain : Promise.resolve();
		const ownSettle = settleFn
			? Promise.resolve()
					.then(() => settleFn.call(element, superInput))
					.catch(error => {
						poisonPending(element, manifest);
						throw error;
					})
			: Promise.resolve();

		/* 4. chain republished to child / await-new:
			*      cap, take → own;  forward → own + parent (await-new aggregates the parent) */
		const chain =
			superMode === 'forward'
				? Promise.all([ownSettle, parentChain]).then(() => {})
				: ownSettle;
		chain.catch(() => {}); // park: bare `new` of a failing settlement must not crash
		state.parentChain = chain;
		state.levels.push({ superMode, ownSettle, chain });

		/* 5. the element is a self-settling thenable bound to the latest chain */
		bindThenable(element, chain);
		return element;
	}

	/* ── helpers (live just above the Instance class) ─────────────────────────
		* The kernel/slot layer above already provides createElement, the slot
		* WeakMaps (STORE/AWAITING), instanceHook, armEffects, thenFor, DSL,
		* Lexeme, JSDOM, AttributeParser, Signal, the INSTANCE/EFFECTS symbols and
		* the destructured Object/Reflect aliases. ifndef + THIS_SCRIPT are the two
		* doc-era helpers worth keeping module-scope (createElement stays module-scope too). */

	const THIS_SCRIPT = (typeof document !== 'undefined' && document.currentScript) || null; // the bootstrapping <script>, for #config

	/* a sensible default so Div/Span/… exist even before any autoclass scan */
	const DEFAULT_SET = {
		core: new Set(JSDOM.ELEMENTS.core.stable),
		math: new Set(),
		svg: new Set()
	};

	/* ════════════════════════════════════════════════════════════════════════
	* §6 — element base + metaclass (proxy-free: this IS the element)
	*   Class-encapsulated: #metaclass builds the per-class Meta proxy; #initialize
	*   generates the configured shape synchronously at load (ifndef-guarded,
	*   alias-aware); define/defineAll are the manual generation API.
	* ════════════════════════════════════════════════════════════════════════ */
	/* ── §PROXY INTERFACES (Pass Q4, 0.73 port — author-spec) ─────────────────────
	 * The callable-proxy pattern over `this[PROXIES](type, factory)`: first access
	 * builds the interface (memoized per element per type in the weak-scoped store);
	 * the returned value is CALLABLE (apply = the primary verb) and carries its verb
	 * surface via get. Dispose drains every built interface (the PROXIES teardown
	 * command) — workers terminate, sockets close, listeners unbind, with the element.
	 * Doctrine: object[SYMBOL] → weak-scoped store → typeof this → machinery. */
	class ProxyInterface {
		get worker() {
			return this[PROXIES]('worker', function () {
				const el = this;
				let _worker = null, _url = null;
				const spawn = (fn) => {
					const src = `self.onmessage = function(e) { self.postMessage((${fn.toString()})(e.data)); }`;
					_url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
					_worker = new Worker(_url);
					return _worker;
				};
				const iface = {
					run(fn, data) {
						return Instance.makeChainable(new Promise((resolve, reject) => {
							const w = _worker ?? spawn(fn);
							w.onmessage = e => resolve(e.data);
							w.onerror = e => reject(e);
							w.postMessage(data);
						}));
					},
					post(data)     { _worker?.postMessage(data); return el; },
					on(event, cb)  { _worker?.addEventListener(event, cb); return el; },
					off(event, cb) { _worker?.removeEventListener(event, cb); return el; },
					remove() {
						_worker?.terminate();
						if (_url) URL.revokeObjectURL(_url);
						_worker = null; _url = null;
						return el;
					}
				};
				return new Proxy(function worker() {}, {
					apply(_, __, [fn, data]) { return iface.run(fn, data); },
					get(_, prop) { return iface[prop]; }
				});
			});
		}
		get socket() {
			return this[PROXIES]('socket', function () {
				const el = this;
				let _socket = null;
				const iface = {
					send(data)     { _socket?.send(typeof data === 'string' ? data : JSON.stringify(data)); return el; },
					on(event, cb)  { _socket?.addEventListener(event, cb); return el; },
					off(event, cb) { _socket?.removeEventListener(event, cb); return el; },
					close()  { _socket?.close(); _socket = null; return el; },
					remove() { this.close(); return el; }
				};
				let p; // apply returns the callable proxy for chaining (author sketch's `return this` would return the trap handler)
				p = new Proxy(function socket() {}, {
					apply(_, __, [url, protocols]) {
						_socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
						return p;
					},
					get(_, prop) { return iface[prop]; }
				});
				return p;
			});
		}
		get listen() {
			return this[PROXIES]('listen', function () {
				const el = this;
				const channels = new Map();
				const dispatch = (e) => {
					const { channel, data } = e.data ?? {};
					if (!channel) return;
					channels.get(channel)?.forEach(cb => cb(data, e));
				};
				const iface = {
					off(channel, cb) { channels.get(channel)?.delete(cb); return el; },
					post(channel, data, target = '*') {
						window.postMessage({ channel, data }, target);
						return el;
					},
					remove() {
						window.removeEventListener('message', dispatch);
						channels.clear();
						return el;
					}
				};
				let p;
				p = new Proxy(function listen() {}, {
					apply(_, __, [channel, cb]) {
						if (!channels.size) window.addEventListener('message', dispatch);
						if (!channels.has(channel)) channels.set(channel, new Set());
						channels.get(channel).add(cb);
						return p;
					},
					get(_, prop) { return iface[prop]; }
				});
				return p;
			});
		}
	}

	class Instance {

		static get this() { return globalThis; } // canonical this-chain root: Instance.this → the global (Pass Q3)

		/*
		static [Symbol.hasInstance](instance) { // Pass Q5: `el instanceof Instance` — the brand is the mint, not a proto-chain link (the iface is a COPY of Instance.prototype, never Instance.prototype itself)
			if (instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) return false;
			if (MINTED.has(instance)) return true;              // a minted element
			try { 
				for (let p = instance; typeof p === 'function'; p = getPrototypeOf(p)) {
					if (p?.name && REGISTRY[p.name] === p) return true;
			 	}
			} catch (e) {} // a Meta (or a user subclass thereof) — walk the function chain to a registered class
			if (instance[INSTANCE]) return true;
			return false;
		}
		*/
		static [Symbol.hasInstance](value) {
			if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
			const self = this;

			// Walk the superclass chain of a constructor, checking for:
			//   - exact match (for Div, etc.)
			//   - if self is Instance, any registered class in the chain is a brand match
			const isSubclassOf = (ctor) => {
				let current = ctor;
				while (current) {
					if (current === self) return true;
					// Brand check for Instance: any ancestor that is a registered class qualifies.
					if (self === Instance && REGISTRY[current.name] === current) return true;
					current = Object.getPrototypeOf(current);
					if (current === Function.prototype) break;
				}
				return false;
			};

			// If value is a class (function), check its superclass chain.
			if (typeof value === 'function') {
				return isSubclassOf(value);
			}

			// If value is an element (object), get its leaf class and check that chain.
			if (typeof value === 'object') {
				const ctor = MINTED.get(value) || value[LEAF] || (value[METADATA] && value[METADATA].constructor);
				if (ctor && typeof ctor === 'function') {
					return isSubclassOf(ctor);
				}
				// Fallback to native instanceof for non‑Instance objects (native elements, plain objects).
				try {
					return Function.prototype[Symbol.hasInstance].call(self, value);
				} catch (_) {
					return false;
				}
			}
			return false;
		}
		
		static TEARDOWN = TEARDOWN; // the symbols' public handles: KRow[Instance.TEARDOWN]()
		static TEARDOWN_ASYNC = TEARDOWN_ASYNC;

		/* ── teardown (Pass Q4) — one body, every face, symbol-keyed (`this[TEARDOWN]`):
		 *   KRow[TEARDOWN]() / KRow.teardown()      → dispose THIS class's live instances (self-destruct; inherited via the symbol-static relay)
		 *   Instance.teardown()                     → dispose every managed element in the document, then Signal.teardown() (arena re-init — ALL handles invalidated)
		 *   Instance.teardown(true)                 → …and unmint: delete every global the typeset definer created, plus Instance itself. Only sane if you own the whole window. */
		static [TEARDOWN](unmint = false) {
			if (this === Instance) {
				const doc = globalThis.document;
				if (doc && doc.documentElement) for (const el of [...doc.querySelectorAll('*')]) { try { if (el[LEAF]) el.remove(true); } catch (e) {} }
				try { typeof Signal !== 'undefined' && Signal.teardown && Signal.teardown(); } catch (e) {}
				if (unmint) {
					for (const k of _MINTED_GLOBALS) { try { delete globalThis[k]; } catch (e) {} }
					_MINTED_GLOBALS.clear();
					for (const k of ['Instance', 'InstanceReady']) { try { delete globalThis[k]; } catch (e) {} }
				}
				return true;
			}
			for (const el of [...(this[ELEMENTS] ?? [])]) { try { el.remove(true); } catch (e) {} } // class face: the live registry, disposed
			return this;
		}
		static async [TEARDOWN_ASYNC](unmint = false) { // the async twin: awaits @removal/@unmount transitions per element
			if (this === Instance) {
				const doc = globalThis.document;
				if (doc && doc.documentElement) for (const el of [...doc.querySelectorAll('*')]) { try { if (el[LEAF]) await Lifecycle.disposeAsync(el); } catch (e) {} }
				try { typeof Signal !== 'undefined' && Signal.teardown && Signal.teardown(); } catch (e) {}
				if (unmint) {
					for (const k of _MINTED_GLOBALS) { try { delete globalThis[k]; } catch (e) {} }
					_MINTED_GLOBALS.clear();
					for (const k of ['Instance', 'InstanceReady']) { try { delete globalThis[k]; } catch (e) {} }
				}
				return true;
			}
			for (const el of [...(this[ELEMENTS] ?? [])]) { try { await Lifecycle.disposeAsync(el); } catch (e) {} }
			return this;
		}
		static teardown(unmint) { return this[TEARDOWN](unmint); }
		static teardownAsync(unmint) { return this[TEARDOWN_ASYNC](unmint); }

		static extend(K) { return K; } // IVC-era hook (Pass Q7): identity today — the seam where version-gated class rewriting will land; enables `CatDiv = Instance.extend(CatDiv)` reassignment without const

		static Events = ø({}); // every event class, ALWAYS reachable here (even where the global name stayed native)

		static initEvents(CTX = globalThis) { // Pass Q8 — mint the event vocabulary (idempotent; boot calls it after typeset so collision checks see the real registry)
			if (Instance.Events.__minted) return Instance.Events;
			const pas = x => _EVT_HINTS[x] || (x ? x[0].toUpperCase() + x.slice(1) : '');
			for (const [prefix, alts] of Object.entries(_EVT_GRAMMAR)) {
				for (const alt of alts.split('|')) {
					if (prefix === '' && alt === '') continue;
					const type = prefix + alt;
					let name = prefix === '' ? pas(type) : pas(prefix) + pas(alt);
					if (REGISTRY[name] || _MINTED_GLOBALS.has(name) || name in CTX) name += 'Event'; // collision → 'Event' postfix (author rule)
					const Klass = _makeEventClass(name, type, CTX);
					defineProperty(Instance.Events, name, { value: Klass, enumerable: true, configurable: true });
					ifndef(CTX, name, () => { _MINTED_GLOBALS.add(name); return Reflect.defineProperty(CTX, name, { value: Klass, writable: true, configurable: true, enumerable: false }); });
				}
			}
			defineProperty(Instance.Events, '__minted', { value: true, configurable: true });
			return Instance.Events;
		}

		/* ── mergeJQuery (Pass Q7 — the 0.73 jQueryInterface, remade) ────────────────
		 * ON BY DEFAULT when jQuery is present at boot; call manually if it loads late.
		 * Grafts every jQuery.fn verb onto every element — HOUSE WINS on collisions:
		 * anything already answered by Instance or the native chain (on/off/remove/
		 * find/first/…) is skipped, so Instance semantics are never surrendered.
		 * Chaining unwraps: a jQuery call returning the same single-element set hands
		 * back the ELEMENT (Instance chaining continues); sets and scalars pass
		 * through untouched. Idempotent — grafted names are visible on the probe. */
		static mergeJQuery(jq = globalThis.jQuery) {
			if (!jq || !jq.fn) return Instance;
			const probe = globalThis.document ? globalThis.document.createElement('div') : {};
			for (const name of Object.getOwnPropertyNames(jq.fn)) {
				if (name === 'constructor' || name === 'init' || name === 'jquery' || name === 'length') continue;
				if (typeof jq.fn[name] !== 'function') continue;
				if (name in Instance.prototype || name in probe) continue; // house + native win
				const fn = function (...args) {
					const wrapped = jq(this);
					const out = wrapped[name](...args);
					return (out === wrapped || (out instanceof jq && out.length === 1 && out[0] === this)) ? this : out;
				};
				try { defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
				const desc = { value: fn, configurable: true, enumerable: false, writable: true };
				defineProperty(Instance.prototype, name, desc);              // future metas copy it at creation
				for (const f of _IFACES) if (!(name in f)) defineProperty(f, name, desc); // existing metas retro-graft
			}
			return Instance;
		}

		static {
			for (const k of ['worker', 'socket', 'listen']) // the callable proxy interfaces ride Instance.prototype → the iface relay → every element
				defineProperty(this.prototype, k, $ownDesc(ProxyInterface.prototype, k));
		}

		static get router() { return _ROUTER; }

		static get _builtinTransitions() { return BUILT_INS; }

		static app(name) { return APPS.get(name); }

		/* class-side face of the compiler's per-level hook: static blocks emit
		 * this[Symbol.for('Instance')](Klass, staticFn, …) at DEFINITION time.
		 * The instance-side face lives on Instance.prototype; this static one was
		 * missing in 0.87 — latent for every compiled class with static fields
		 * (surfaced by app scripts, Pass N). Metas inherit it via the own-symbol
		 * relay in #metaclass; root-extenders resolve it directly. */
		static [INSTANCE](Klass, staticFn) {
			if (typeof staticFn === 'function') staticFn.call(Klass);
			return Klass;
		}

		static get _i18n() { return _I18N; }
		static i18n(translations) {
			_I18N = translations || null;
			if (typeof document !== 'undefined')
				document.querySelectorAll('intl[key]').forEach(el => { Instance.upgrade(el); _applyIntl(el); }); // upgrade is idempotent — covers <intl> minted after boot; re-apply for dictionary swaps
			return Instance;
		}

		/* ── upgrade — wake a raw, already-parsed element in place. The declarative
		 * mirror of `new Klass()`: the node rides the adoption slot (the element IS
		 * the instance — proto-splice + store + registry, no fresh createElement),
		 * and if it's already connected the enter transition fires NOW (@insertion,
		 * @mount once, @rendered post-paint) — the connection event it would have
		 * needed already passed. Disconnected nodes stay cold: the Lifecycle
		 * observer runs enter when they actually land. Idempotent: an element that
		 * is already an instance (LEAF set) returns itself untouched. */
		static upgrade(node) {
			if (!node || node.nodeType !== 1) return null;
			if (node[LEAF]) return node; // already an instance — nothing to do
			const Klass = CUSTOM_TAGS.get(node.localName);
			if (!Klass) return null;
			_UPGRADE = node;
			let el;
			try { el = new Klass(); } finally { _UPGRADE = null; } // constructor consumes the one-shot via _adoptClaim
			if (doc && doc.contains(el)) Lifecycle.enter(el);
			return el;
		}

		/* ── ⚡⚡ SUPER MODE — declarative custom elements, document-wide. Engine
		 * mode redirects native constructors; super mode goes the other way: raw
		 * markup whose tag matches a registered Instance class is upgraded in
		 * place — at superup for everything already parsed, then live via one
		 * childList observer. Requires engine mode (superup auto-powers-up;
		 * powerdown force-supers-down — ⚡⚡ never runs without ⚡). The CORE_TAGS
		 * ring is NOT gated by this: the built-in vocabulary boots unconditionally;
		 * super mode extends the same machinery to user-defined classes. */
		static superup() {
			if (_SUPER.on) return Instance;
			Instance.powerup(); // ⚡⚡ cannot run without ⚡
			_SUPER.on = true;
			if (doc) {
				_superSweep(doc);
				const root = doc.body || doc.documentElement;
				if (root && typeof MutationObserver !== 'undefined') {
					_SUPER.obs = new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(_superWalk)));
					_SUPER.obs.observe(root, { childList: true, subtree: true });
				}
			}
			Instance.debug('info', '[Instance] ⚡⚡ super mode — declarative custom elements live');
			return Instance;
		}
		static superdown() {
			if (!_SUPER.on) return Instance;
			_SUPER.on = false;
			if (_SUPER.obs) { _SUPER.obs.disconnect(); _SUPER.obs = null; }
			Instance.debug('info', '[Instance] ⚡⚡ super mode off — existing instances stay live');
			return Instance;
		}

		static powerup() {
			if (_ENGINE.on) return Instance;
			_ENGINE.on = true;
			_installTree();
			for (const pair of _ENGINE.pairs) pair[2] ? pair[2](true) : _engineSwapCtor(pair[0], pair[1]);
			Instance.debug('info', '[Instance] ⚡ engine powered up — live tree + native constructors redirected');
			return Instance;
		}

		static powerdown() {
			if (_SUPER.on) Instance.superdown(); // invariant: ⚡⚡ never outlives ⚡
			for (const pair of _ENGINE.pairs) if (pair[2]) pair[2](false); // splice back, restore ctors per tag
			_ENGINE.ctors.forEach((original, proto) => {
				if (original) { Object.defineProperty(proto, 'constructor', original); }
				else          { delete proto.constructor; }
			});
			_ENGINE.ctors.clear();
			_uninstallTree();
			_ENGINE.on = false;
			Instance.debug('info', '[Instance] ⚡ engine powered down — native constructors restored');
			return Instance;
		}

		
		static #once;
		static #debugger;

		static debug(...args) {
			if (Instance.#debugger) console.warn(...args);
			else return null;
		}
		static debugMode(on = true) {
			Instance.#debugger = !!on;
			return Instance.#debugger;
		}
		static #warn(...args) {
			console.warn(...args);
		}

		static {
			Object.defineProperties(this, {
				[Symbol.species]: { configurable: false }, // kept: species lets elements survive native methods (map/filter) as their own class
				mode: { value: 'strict' },
				id: { value: 'INSTANCE' },
				expando: {
					value: ('Instance' + (+new Date() + Math.random())).replace(/\./g, '')
				},
				UID: {
					writable: true,
					configurable: true,
					value(key = '') {
						return Symbol(String(key));
					}
				},
				UNS: {
					writable: true,
					configurable: true,
					value(prefix) {
						const ns = Instance.UUID(prefix);
						return key => Symbol.for(Symbol.keyFor(ns) + '/' + key);
					}
				}
			});
		}

		constructor(...args) {
			const target = new.target;
			if (target === Instance) {
				// boot path: new Instance(global) → synchronous shape generation
				if (!Instance.#once) Instance.#initialize(args[0]);
				return; // not an element
			}
			/* static-is contract (Pass N): identity mirrors the inheritance.
			 * extends Instance → own tag (<scrollbar>, chain …→Meta→HTMLUnknownElement);
			 * extends a tag Meta → web-compat (<div data-is="Scrollbar">);
			 * static is = 'element' | 'web-compat' | 'data' overrides either way. */
			const __is = Instance.#isContract(target);
			if (__is && __is.mode === 'data')
				return new Signal.Store(args.length && args[0] !== null && typeof args[0] === 'object' ? args[0] : {});
			const element = (__is && __is.adopted) || createElement(target.id || 'div', target.ns || 'html');
			setPrototypeOf(element, target.prototype);
			if (__is) {
				if (__is.dataIs) element.setAttribute('data-is', __is.dataIs); // the id mirrors the classname exactly
				if (!__is.adopted && _ADOPT) _ADOPT.appendChild(element);     // fresh instance lands in the app scope
			}
			

			let route = null;
			const contentItems = [];
			for (const arg of args) {
				if (typeof arg === 'string' && arg[0] === '@' && route === null) {
					route = arg;               // first @‑directive is the placement
				} else {
					contentItems.push(arg);    // everything else is content
				}
			}

			// Populate content after element creation
			if (contentItems.length > 0) {
				// Fast path: single plain text without HTML
				if (contentItems.length === 1 && typeof contentItems[0] === 'string' && !/<[^>]+>/.test(contentItems[0])) {
					element.textContent = contentItems[0];
				} else {
					// Build a fragment to append all items in order
					const frag = document.createDocumentFragment();
					for (const item of contentItems) {
						if (item instanceof Node) {
							frag.appendChild(item);
						} else if (typeof item === 'string') {
							if (/<[^>]+>/.test(item)) {
								// Parse as HTML and extract children
								const temp = document.createElement('div');
								temp.innerHTML = item;
								while (temp.firstChild) {
									frag.appendChild(temp.firstChild);
								}
							} else {
								frag.appendChild(document.createTextNode(item));
							}
						} else if (item != null) {
							// Convert numbers, booleans, etc. to text
							frag.appendChild(document.createTextNode(String(item)));
						}
					}
					element.appendChild(frag);
				}
			}

			element[LEAF] = target; // off-element: leaf class via the minted LEAF accessor (loop-backed)
			STORE.set(element, new Signal.Store()); // off-element: one reactive store per element (replaces the per-instance splice)
			MINTED.set(element, target); // identity: new.target IS the queried class — Div for `new Div()`, the leaf for subclasses
			if (element.isConnected) Lifecycle.register(element); // live-DOM registry (Pass Q3): existence begins at insertion — detached mints register at first mount
			
			if (route !== null && doc) {
				DSL.route(DSL.parse(route), element, doc); // place via the DSL, once the element is fully wired
			}

			return element; // constructor returns the element → `this` is the element everywhere up-chain
		}
		appendTo(targetOrSelector) {
			const parent =
				targetOrSelector === 'body'
					? doc.body
					: typeof targetOrSelector === 'string'
						? doc.querySelector(targetOrSelector)
						: targetOrSelector;
			if (parent) Lifecycle.reattach(this, parent, null); // house verb ⇒ SYNCHRONOUS enter: connected and registered before appendTo returns (raw appendChild stays observer-driven, one microtask behind)
			return this;
		}

		// ── #metaclass (verbatim behavior from 0.85.5): raw element + typeof-receiver Meta proxy ──
		static #metaclass(lexeme, namespace) {
			const className = String(lexeme);
			const tagId = lexeme.id;
			const ns = namespace || 'html';
			const nativeProto = getPrototypeOf(createElement(tagId, ns));

			/* ── per-tag prototype (Pass Q6): shared cross-element prototypes — NEVER; the tag is isolate.
			 * Resolved name = 'HTML' + className (baddie suffix stripped) + 'Element'. If the tag's real
			 * native interface already carries exactly that name (div → HTMLDivElement), REUSE it — zero
			 * layers. Otherwise the platform was lazy (section → bare HTMLElement; thead → shared
			 * HTMLTableSectionElement; tr → differently-named HTMLTableRowElement) and we SYNTHESIZE the
			 * interface that should have existed: correctly named, @@toStringTag'd, statics chained,
			 * prototype inheriting the REAL native proto (instanceof stays faithful), exposed on the
			 * realm ifndef-style and recorded for unmint. The Meta then parents to the per-tag proto —
			 * and in engine mode the splice lands on a PER-TAG link, so it can never leak across tags. */
			const IFACE_NAME = 'HTML' + className.replace(/Element$/, '') + 'Element';
			let tagProto = nativeProto;
			{
				const nCtor = nativeProto && nativeProto.constructor;
				if (!nCtor || nCtor.name !== IFACE_NAME) {
					const cached = _TAG_IFACES.get(IFACE_NAME);
					if (cached) tagProto = cached.prototype;
					else {
						const IfaceCtor = function () { throw new TypeError('Illegal constructor'); };
						defineProperty(IfaceCtor, 'name', { value: IFACE_NAME, configurable: true });
						tagProto = $create(nativeProto);
						defineProperty(tagProto, 'constructor', { value: IfaceCtor, writable: true, configurable: true, enumerable: false });
						defineProperty(tagProto, Symbol.toStringTag, { value: IFACE_NAME, configurable: true }); // WebIDL-faithful: [object HTMLSectionElement]
						defineProperty(IfaceCtor, 'prototype', { value: tagProto, writable: false, enumerable: false, configurable: false });
						if (typeof nCtor === 'function') setPrototypeOf(IfaceCtor, nCtor); // interface statics chain like the platform's do
						ifndef(globalThis, IFACE_NAME,
							() => { _MINTED_GLOBALS.add(IFACE_NAME); return Reflect.defineProperty(globalThis, IFACE_NAME, { value: IfaceCtor, writable: true, configurable: true, enumerable: false }); });
						_TAG_IFACES.set(IFACE_NAME, IfaceCtor);
					}
				}
			}
			const tagParent = getPrototypeOf(tagProto);

			const BaseCtor = function() {
				return Reflect.construct(Instance, arguments, new.target || Meta);
			};

			/* class metadata; configurable so the Meta proxy may route an instance-level
			set of the same name (element.id = …, element.name = …) to the element
			instead of tripping the proxy's non-configurable [[Set]] invariant */
			defineProperties(BaseCtor, {
				name: { value: className, configurable: true },
				id: { value: tagId, configurable: true, writable: false, enumerable: false }, // was configurable:false — tripped the proxy [[Get]] invariant on every element.id read (mirror of the name fix above)
				ns: { value: ns, configurable: true }
			});

			/* a clean instance interface: the Instance methods layered over the native
				prototype, on a plain object so function junk (name/length) can't shadow
				element properties
			*/
			const iface = $create(tagProto); // the Instance method layer over the PER-TAG link (engine mode retargets to tagParent so trap fall-through never re-enters the Meta)
			_IFACES.push(iface);
			for (const key of Reflect.ownKeys(Instance.prototype))
				if (key !== 'constructor')
					defineProperty(iface, key, $ownDesc(Instance.prototype, key));

			/* the static face: relay every symbol static installed on Instance (the hooks + the well-knowns)
				onto BaseCtor, so static blocks and class-level well-knowns resolve via readStatic. Skip species
				— Instance pins it non-configurable, and element classes keep their inherited species. */
			for (const k of Object.getOwnPropertySymbols(Instance)) {
				if (k !== Symbol.species) {
					defineProperty(BaseCtor, k, $ownDesc(Instance, k)); // @@hasInstance: Metas keep OrdinaryHasInstance so `x instanceof Div` stays tag-specific (Pass Q5)
				}
			}
			/* the STRING protocol (Pass Q8b·search): the five regex well-knowns live on
			 * WellKnownSymbols.prototype (instance face). Relay them onto the class too, so
			 * `query.search(Card)` dispatches to the same body with this===Card — the
			 * `typeof this === 'function'` branch searches Card[ELEMENTS] and returns a
			 * registry index. Both receivers, one implementation. */
			for (const k of [Symbol.search, Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.split]) {
				const d = $ownDesc(WellKnownSymbols.prototype, k);
				if (d) defineProperty(BaseCtor, k, d);
			}
			for (const k of ['flags', 'global']) { // matchAll reads .flags off the class before dispatch
				const d = $ownDesc(WellKnownSymbols.prototype, k);
				if (d) defineProperty(BaseCtor, k, d);
			}

			const readStatic = (prop, receiver) => {
				if (prop === 'this') { // canonical this-chain, static face (Q3 formula + Q6 skip-self: in engine shape the Meta sits behind the per-tag proto and must not answer for itself)
					if (receiver === Instance) return globalThis;
					let pp = receiver.prototype && getPrototypeOf(receiver.prototype);
					let c = pp && (typeof pp === 'function' ? pp : pp.constructor);
					if (c === receiver) { pp = pp && getPrototypeOf(pp); c = pp && (typeof pp === 'function' ? pp : pp.constructor); }
					return c || getPrototypeOf(receiver);
				}
				if (typeof prop === 'string' && prop.length && prop.charCodeAt(0) >= 48 && prop.charCodeAt(0) <= 57 && /^\d+$/.test(prop)) {
					let _r; try { _r = receiver[ELEMENTS]; } catch (e) { _r = null; } // numeric class indexing: Div[0] is the first LIVE div (native array semantics over the registry)
					return Array.isArray(_r) ? _r[+prop] : undefined;
				}
				const desc = $ownDesc(BaseCtor, prop);
				if (desc) return desc.get ? desc.get.call(receiver) : desc.value;
				if (prop === 'teardown') return function (u) { return this[TEARDOWN](u); }.bind(receiver); // named aliases over the symbol verbs (Pass Q4)
				if (prop === 'teardownAsync') return function (u) { return this[TEARDOWN_ASYNC](u); }.bind(receiver);
				const _cm = COLLECTION_STATIC.get(prop);
				return _cm ? _cm.bind(receiver) : undefined; // collection query over Class[ELEMENTS]
			};

			const Meta = new Proxy(BaseCtor, {
				construct(target, args, newTarget) {
					return Reflect.construct(target, args, newTarget);
				},
				get(target, prop, receiver) {
					if (typeof receiver === 'function') return readStatic(prop, receiver); // STATIC: receiver is the class
					
					const ss = STORE.get(receiver); // INSTANCE: per-element store
					if (ss) {
						if (prop === REACTIVE_STORE) return ss;
						if (isAcc(prop)) return prop === 'ψ' ? ss.ψFor(receiver) : ss[prop];     // Route triad accessors ($, $$, ψ, etc.)
						if (isRK(prop)) { if (ss.has(prop)) return ss.read(prop); } // store fields/computeds → V17 API; otherwise (e.g. @-named methods) fall through to the prototype
					}
					
					if (prop === 'this') return MINTED.get(receiver) ?? receiver.constructor; // canonical this-chain, instance face: this.this → the class it was minted as (Pass Q3)
					if (prop === 'then')
						return AWAITING.has(receiver) ? thenFor(receiver) : undefined; // virtual await-new thenable
					const _v = Reflect.get(iface, prop, receiver); // the native / Instance interface wins
					if (_v !== undefined) return _v;
					let __ln; try { __ln = receiver.localName; } catch (e) { __ln = void 0; } // exotic receivers (Object.create over a Meta, brand-mismatched hosts) must not detonate the internal probe — host accessors brand-check `this` (Pass Q)
					if (prop === __ln && _NAMESPACES.has(prop)) return _nsFacade(receiver); // el.form, el.input, … (Pass I)
					return _v;
				},

				set(target, prop, value, receiver) {

					if (typeof receiver === 'function') {
						return Reflect.set(target, prop, value, receiver);
					}
					const ss = STORE.get(receiver);
					if (ss && typeof prop === 'string' && isRK(prop)) {
						ss.write(prop, value); // V17 API writethrough
						return true; 
					}
					
					return Reflect.set(iface, prop, value, receiver);
				}
			});
			Meta.prototype = Meta;                 // NON-ENGINE (visible Meta): el → Meta → tagProto → native…
			setPrototypeOf(Meta, tagProto);        // …and the default-trap forwarding (has/gOPD/get-miss) continues down the per-tag chain
			/* ── the engine-mode splice (Pass Q6): same architecture, the Meta changes SLOT.
			 *    ENGINE (hidden Meta): el → tagProto (gp() NATIVE) → Meta → tagParent → …
			 *    apply(on) is toggle-symmetric; powerup/powerdown drive it per pair. */
			const _applyEngine = on => {
				if (on) {
					try { Meta.prototype = tagProto; } catch (e) {}
					setPrototypeOf(Meta, tagParent);
					setPrototypeOf(tagProto, Meta);    // the one-time structural op — per-TAG, so it can never leak across tags
					setPrototypeOf(iface, tagParent);  // trap fall-through skips the Meta (no re-entry)
					_engineSwapCtor(tagProto, Meta);   // per-tag ctor identity (fixes the old shared-proto swap bug)
				} else {
					setPrototypeOf(tagProto, tagParent);
					try { Meta.prototype = Meta; } catch (e) {}
					setPrototypeOf(Meta, tagProto);
					setPrototypeOf(iface, tagProto);
					const orig = _ENGINE.ctors.get(tagProto);
					if (orig !== undefined) { if (orig) defineProperty(tagProto, 'constructor', orig); else delete tagProto.constructor; _ENGINE.ctors.delete(tagProto); }
				}
			};
			_ENGINE.pairs.push([tagProto, Meta, _applyEngine]);
			if (_ENGINE.on) _applyEngine(true);
			defineProperty(Meta, 'constructor', { value: Meta, configurable: true, writable: true });
			return Meta;
		}

		static #customMetas = new Map(); // classname-tag → minted Meta (element-mode)
		static #spliced = new WeakSet(); // classes already rebased onto a Meta

		/* Resolve the static-is contract for a leaf class. Also performs the ONE-TIME
		 * chain splice for element-mode: the topmost user class sitting directly on
		 * Instance is rebased onto a freshly minted per-classname Meta, so both the
		 * static face (id/ns) and the instance chain flow through the metaclass:
		 *   {{Sub}} → {{Top}} → Meta(<topname>) → native proto (HTMLUnknownElement). */
		static #isContract(NT) {
			if (!NT || NT.prototype === NT) return null; // a Meta constructed directly: legacy path
			const isMeta = (K) => !!K && (K.prototype === K || (typeof K === 'function' && K.prototype && getPrototypeOf(K.prototype) === K)); // both shapes: self-prototype (non-engine) OR the per-tag proto pointing back (engine splice, Pass Q6)
			const ownStatic = (key) => {
				for (let p = NT; p && p !== Instance && !isMeta(p); p = getPrototypeOf(p)) {
					const d = $ownDesc(p, key);
					if (d && typeof d.value === 'string') return d.value;
				}
				return null;
			};
			const mode0 = ownStatic('is');
			const name = NT.name || 'Anonymous';
			if (mode0 === 'data') return { mode: 'data' };

			const metaFor = (tag, display) => {
				let M = Instance.#customMetas.get(tag);
				if (!M) { M = Instance.#metaclass({ id: tag, toString() { return display; } }, ownStatic('namespace') || 'html'); Instance.#customMetas.set(tag, M); }
				return M;
			};
			const rebase = (K, M) => { setPrototypeOf(K, M); setPrototypeOf(K.prototype, M); Instance.#spliced.add(K); };
			// splice: any chain arriving here must flow through a Meta — statics (id/ns)
			// and the instance chain both need it. Explicit 'element' claims its own tag
			// at THIS class; otherwise the topmost class sitting on bare Instance rebases
			// (web-compat → the div Meta; default → a minted Meta for its own name).
			if (mode0 === 'element') {
				if (!Instance.#spliced.has(NT)) { rebase(NT, metaFor(name.toLowerCase(), name)); CUSTOM_TAGS.set(name.toLowerCase(), NT); } // first mint indexes the tag — declarative upgrades need no explicit define()
			} else {
				let top = NT, q;
				while ((q = getPrototypeOf(top)) && q !== Instance && !isMeta(q)) top = q;
				if (q === Instance && !Instance.#spliced.has(top)) {
					rebase(top, mode0 === 'web-compat'
						? metaFor('div', 'Div')
						: metaFor((top.name || name).toLowerCase(), top.name || name));
					if (mode0 !== 'web-compat') CUSTOM_TAGS.set((top.name || name).toLowerCase(), top); // own-tag mode only — <div data-is> carriers are not upgrade targets
				}
			}
			const mode = mode0 || (Instance.#spliced.has(NT) ? 'element' : 'web-compat');
			/* static sigil lift (Pass Q2): `static $label = v` on a leaf class becomes a
			 * CLASS-LEVEL signal — one per defining class, shared by every instance (the
			 * broadcast bus). Reads are tracked (effects subscribe), writes notify. The
			 * accessor is idempotent (data desc → accessor once); frozen classes skip,
			 * same doctrine as the toStringTag brand below. Subclasses inherit the
			 * accessor through the class chain and therefore SHARE the defining class's
			 * signal — that is the point. $-tier only; Δ/ø statics stay literal for now. */
			if (Object.isExtensible(NT)) {
				let __cs = null; // one lazy Store per class, closed over by its accessors
				for (const __k of Object.getOwnPropertyNames(NT)) {
					if (__k[0] !== '$' || __k.length < 2) continue;
					const __d = $ownDesc(NT, __k);
					if (!__d || !('value' in __d) || typeof __d.value === 'function' || !__d.configurable) continue;
					__cs = __cs || new Signal.Store(); // same construction as the element stores — the V17 read/write API is the reactive surface
					__cs.write(__k, __d.value);
					const __key = __k, __store = __cs;
					defineProperty(NT, __key, {
						get() { return __store.read(__key); },  // tracked — an active Effect subscribes here
						set(v) { __store.write(__key, v); },    // V17 writethrough — triggers subscribers
						configurable: true, enumerable: !!__d.enumerable
					});
				}
			}
			if (!$ownDesc(NT.prototype, Symbol.toStringTag) && Object.isExtensible(NT.prototype))
				defineProperty(NT.prototype, Symbol.toStringTag, { get() { return name; }, configurable: true }); // a user-frozen class prototype simply keeps the default tag — branding must not throw the mint (Pass Q)
			if (mode === 'web-compat')
				return { mode, dataIs: name, adopted: _adoptClaim('[data-is="' + name + '"]') };
			return { mode: 'element', adopted: _adoptClaim(String(NT.id || name).toLowerCase()) };
		}

		// ── #proxify — the lowercase variant (div vs Div); raw elements aren't callable, so no arg-unwrap ──
		static #proxify(Metaclass) {
			return new Proxy(Metaclass, {
				apply(_, __, args) { return new Metaclass(...args) },
				construct(_, args) { return new Metaclass(...args) },
				get(_, prop) { return prop === INSTANCE ? Metaclass : Metaclass[prop] }
			});
		}

		// ── manual generation API: one class (define) / a bucket set (defineAll) ──
		static define(tag, ns = 'html', convention = 'pascalite') {
			/* custom-class overload — define(Klass): index an Instance-extender for
			 * declarative upgrading (boot ring for CORE_TAGS; ⚡⚡ super mode for the
			 * rest). Tag = static id (if declared) else the lowercased class name;
			 * REGISTRY gains the class under its own name so Instance.elements sees
			 * it and a later define('tag') round-trips to the same class. */
			if (typeof tag === 'function' && tag.prototype !== tag) {
				const Klass = tag;
				const custom = String(($ownDesc(Klass, 'id') && Klass.id) || Klass.name).toLowerCase();
				CUSTOM_TAGS.set(custom, Klass);
				REGISTRY[Klass.name] ??= Klass;
				return Klass;
			}
			const lexeme = new Lexeme(tag, convention);
			const className = String(lexeme);
			if (REGISTRY[className]) return REGISTRY[className];
			const ElementClass = Instance.#metaclass(lexeme, ns);
			REGISTRY[className] = ElementClass;
			/* expose globally for `class App extends Div` — skip names colliding with
	critical natives (Image/Option/…); those stay reachable via Instance.elements */
			if (
				!JSDOM.ISBADDIE.test(className) &&
				!(className in global && JSDOM.ISBADDIE.test(className))
			) {
				global[className] = ElementClass;
			}
			return ElementClass;
		}
		static defineAll(nameSets, convention) {
			for (const ns of ['core', 'math', 'svg'])
				for (const tag of nameSets[ns] || [])
					Instance.define(tag, ns === 'core' ? 'html' : ns, convention);
		}

		// ── #initialize — synchronous, config-driven shape generation (restored from the class era) ──
		// Reads the bootstrapping <script>'s autoclass/typeset (falls back to DEFAULT_SET
		// + pascalite when there's no script, e.g. under Node), then defines each class on
		// CTX with an ifndef collision guard, a lowercase variant, and every typeset alias.
		static #initialize(CTX) {
			if (this.#once) return;
			this.#once = true;

			const CONFIG = new AttributeParser(THIS_SCRIPT, {
				typeset: () => {},
				autoclass: () => {},
				engine: () => {},
				super: () => {},
				mode: { strict: ['flexible', 'strictest'] },
				events: true,
				noglobals: [false, [true, 'init']],
				debug: [false, [true, 'init']]
			}) ?? { engine: null };

			Instance.#debugger = !!CONFIG.debug; // the `debug` script attribute now drives the debug-gated warner
			if (CONFIG.engine) Instance.powerup();          // <script engine> boots engine mode
			if (CONFIG.super) Instance.superup();           // <script super> boots ⚡⚡ (implies engine mode)

			const NAMESPACES = CONFIG.autoclass || DEFAULT_SET; // { core:Set, math:Set, svg:Set }
			const typesetList = CONFIG.typeset || [{ key: 'pascalite', value: null }]; // [master, …aliases]; each { key: convention, value: prefix }
			const [MasterConvention, ...ALIASES] = typesetList;
			const { key: convention, value: prefix } = MasterConvention;
			const MODE = (() => {
				switch (Instance.mode) {
					case 'flexible': return { writable: true, configurable: true, enumerable: false };
					case 'strictest': return { writable: false, configurable: false, enumerable: false };
					default: return { writable: false, configurable: true, enumerable: false };
				}
			})();

			for (const NAMESPACE of Object.getOwnPropertyNames(NAMESPACES)) {
				// core, math, svg
				const ns = NAMESPACE === 'core' ? 'html' : NAMESPACE;
				for (const TAG of NAMESPACES[NAMESPACE]) {

					const LEXEME = new Lexeme(TAG, convention).prefix(prefix).suffixize(JSDOM.ISBADDIE, 'Element');
					const className = String(LEXEME);

					ifndef(CTX, LEXEME,
						() => {
							// collision-safe global definition
							const Metaclass = (REGISTRY[className] ??= Instance.#metaclass(LEXEME, ns));
							Reflect.defineProperty(CTX, LEXEME, Object.assign({ value: Metaclass }, MODE));
							_MINTED_GLOBALS.add(className);

							const lower = LEXEME.toLowerCase();
							ifndef(CTX, lower, () =>
								_MINTED_GLOBALS.add(lower) && Reflect.defineProperty(CTX, lower, {
									get: () => Instance.#proxify(Metaclass),
									configurable: true,
									enumerable: false
								})
							);
							ALIASES.forEach(({ key: conv, value: pref }) => {
								// every extra convention → another global → same Metaclass
								const ALT = LEXEME.alias(conv).prefix(pref).suffixize(JSDOM.ISBADDIE, 'Element');
								ifndef(CTX,ALT, 
									() => { _MINTED_GLOBALS.add(String(ALT)); return Reflect.defineProperty(CTX, ALT, Object.assign({ value: Metaclass }, MODE)); },
									() => Instance.debug(`@${conv} [${ALT}]: alias overlaps an existing property. Skipping.`)
								);
							});
						},
						() => Instance.#warn(`Class [${className}] could not be defined. Skipping.`)
					);
				}
			}
		}
	}

	/* ════════════════════════════════════════════════════════════════════════
		* §9 — compile + execute .is source
		* ════════════════════════════════════════════════════════════════════════ */
	function compile(source) {
		if (!COMPILER) throw new Error('[Instance] InstanceCompiler is not loaded — cannot compile .is source');

		const { code, diagnostics } = COMPILER.compile(source);
		if (diagnostics)
			for (const d of diagnostics)
				if (d && d.level === 'warn') Instance.debug('[Instance]', d.message);
		return code;
	}
	/* runs compiled JS in global scope; element classes are global, so `extends Div`
		* resolves. Wrapped in an async IIFE so top-level `await new X()` works. */
	function run(source, { compiled = false, async = true } = {}) {
		const js = compiled ? source : compile(source);
		const body = async ? '(async()=>{\n' + js + '\n})()' : js;
		return (0, eval)(body);
	}

	/* ════════════════════════════════════════════════════════════════════════
		* §10 — bootstrap: scan the page, generate elements, compile + run
		* ════════════════════════════════════════════════════════════════════════ */

	/* ════════════════════════════════════════════════════════════════════════
		* §6.5 — lifecycle + lifetime. The imperative methods (detach / reattach /
		*   dispose) are synchronous and deterministic: each performs the DOM operation,
		*   then fires the lifecycle hooks AFTER it with an explicitly-captured ctx
		*   (the element's own parent is gone once it has left), then flags the element
		*   so the observer ignores the record the operation produced. The
		*   MutationObserver is the nondeterministic FALLBACK — it runs the same
		*   transitions only for raw mutations that bypassed the API (adversarial input,
		*   forgetfulness). An element's lifetime is decoupled from its DOM presence:
		*   leaving the DOM detaches (state preserved across any gap); only dispose
		*   tears down, bridging into Chimera's deletion lifecycle. Hooks splice via
		*   the no-op hooks + imperative surface (folded into Lifecycle here); observer, fire logic,
		*   lifetime state and kernel reclaim live on Lifecycle.
		*     ['@insertion'](ctx)  every entry      ['@removal'](ctx)  every exit (never tears down)
		*     ['@mount'](ctx)      first entry only  ['@unmount'](el)   on dispose only — teardown is always explicit
		*     ['@rendered'](el)    post-paint, once  ctx = the parent at the transition (former parent on exit)
		*   el.detach() ≡ el.remove()    leave the DOM, stay alive (the default for any removal)
		*   el.reattach(parent, before?) return to the DOM, mount state intact
		*   el.dispose() ≡ unmount() ≡ remove(true)   the only teardown: @unmount + free the reactive scope
		* ════════════════════════════════════════════════════════════════════════ */
	class Lifecycle extends Interface {

		static #mounted = LC_MOUNTED; // @mount has fired, once-ever
		static #detached = LC_DETACHED; // off-DOM but alive — the default for any removal
		static #handledExit = LC_HANDLED_EXIT; // explicit exit ran — observer skips that removal record
		static #handledEnter = LC_HANDLED_ENTER; // explicit enter ran — observer skips that addition record

		static #observer = null;
		static #raf = globalThis.requestAnimationFrame?.bind(globalThis) ?? (fn => setTimeout(fn, 16));

		// detach: leave the DOM, stay alive. Unlink, then fire @removal after it with the
		// parent captured beforehand, then flag the element so the observer skips the record.
		static detach(el) {
			if (!doc?.contains(el)) return el;
			const parent = el.parentElement; // ctx, captured before the op — gone after
			el.parentNode.removeChild(el);
			Lifecycle.#sweep(el, e =>
				Lifecycle.#onExit(e, e === el ? parent : e.parentElement)
			);
			Lifecycle.#handledExit.add(el);
			return el;
		}

		// visit a node and every managed descendant
		static #sweep(node, visit) {
			if (node[LEAF]) visit(node);
			const walker = doc.createTreeWalker(node, 0x1, {
				acceptNode: el => (el[LEAF] ? 1 : 3)
			}); // SHOW_ELEMENT ; ACCEPT : SKIP
			for (let el = walker.nextNode(); el; el = walker.nextNode()) visit(el);
		}

		/* ── live-DOM registry (Pass Q3): an element EXISTS in Class[ELEMENTS] only while
		 * it is in the document. Detach splices it out (native array semantics — indices
		 * shift); its slot is remembered, and a reattach re-inserts it at the same spot:
		 * [a,(b),c] → detach b → [a,c] → reattach b → [a,(b),c]. Dispose forgets forever.
		 * Because the registry only ever references connected elements, it cannot pin
		 * memory the document isn't already pinning — the leak class is gone by
		 * construction, no WeakRef indirection needed. */
		static #regIdx = new WeakMap(); // el → last index (consumed by the next register)
		static #registryOf(el) {
			let C = MINTED.get(el);
			if (typeof C !== 'function') { try { C = el.constructor; } catch (e) { C = null; } } // fallback: in-place upgrades and adopted natives
			if (typeof C !== 'function') return null;
			let reg; try { reg = C[ELEMENTS]; } catch (e) { reg = null; }
			if (!Array.isArray(reg)) { reg = []; try { C[ELEMENTS] = reg; } catch (e) { return null; } }
			return reg;
		}
		static register(el) {
			const reg = Lifecycle.#registryOf(el);
			if (!reg || reg.indexOf(el) !== -1) return;
			const at = Lifecycle.#regIdx.get(el);
			if (at !== undefined) { Lifecycle.#regIdx.delete(el); reg.splice(Math.min(at, reg.length), 0, el); }
			else reg.push(el);
		}
		static deregister(el, forget) {
			const reg = Lifecycle.#registryOf(el);
			if (reg) {
				const idx = reg.indexOf(el);
				if (idx !== -1) { reg.splice(idx, 1); if (!forget) Lifecycle.#regIdx.set(el, idx); }
			}
			if (forget) Lifecycle.#regIdx.delete(el);
		}

		// exit transition: fire @removal, then mark detached — preserve, never tear down
		static #onExit(el, ctx) {
			Lifecycle.deregister(el); // out of the document ⇒ out of the registry (index remembered)
			Lifecycle.#fire(el, '@removal', ctx);
			Lifecycle.#detached.add(el);
		}

		// fire one hook (adapted from 0.73.m _fireLC). ctx is explicit because hooks fire
		// AFTER the op; the return is surfaced so the async path can await it.
		static #fire(el, key, ctx) {
			const method = el[key];
			if (typeof method !== 'function' || method === Instance.prototype[key]) return; // an override, not the no-op default
			try {
				return method.call(el, ctx);
			} catch (e) {
				console.warn(`[Instance] ${key}() error:`, e);
			}
		}

		// reattach: return to the DOM, mount state intact
		static reattach(el, parent, before = null) {
			if (!parent) return el;
			parent.insertBefore(el, before);
			Lifecycle.#sweep(el, e => Lifecycle.#onEnter(e, e.parentElement));
			Lifecycle.#handledEnter.add(el);
			return el;
		}

		// enter transition: clear a pending detach, fire @insertion, @mount the first time
		static #onEnter(el, ctx) {
			Lifecycle.#detached.delete(el);
			Lifecycle.register(el); // back in the document ⇒ back in the registry, at the remembered spot
			Lifecycle.#fire(el, '@insertion', ctx);
			if (Lifecycle.#mounted.has(el)) return;
			Lifecycle.#mounted.add(el);
			Lifecycle.#fire(el, '@mount', ctx);
			Lifecycle.#raf(() => doc.contains(el) && Lifecycle.#fire(el, '@rendered', el)); // post-paint, the one async hook
		}

		/* enter — run the enter transition NOW, in place (no move). The seam for
		 * Instance.upgrade(): a node woken after its connection event has already
		 * passed still needs @insertion/@mount/@rendered. Does NOT flag
		 * #handledEnter — there is no pending observer record to consume, and
		 * poisoning the flag would make the observer skip a FUTURE legit addition. */
		static enter(el) {
			Lifecycle.#sweep(el, e => Lifecycle.#onEnter(e, e.parentElement));
			return el;
		}

		// dispose: the only teardown. Leave the DOM first, then destroy. Thenable
		// returns from @unmount listeners (exit transitions) GATE the reclaim — the
		// deferred-teardown contract. Zero thenables → fully synchronous, returns el;
		// otherwise returns Promise<el> resolving after the hooks settle.
		static dispose(el) {
			if (doc?.contains(el)) Lifecycle.detach(el); // @removal + ctx, flags #handledExit
			const pending = [];
			Lifecycle.#sweep(el, e => {
				if (Lifecycle.#mounted.delete(e)) {
					const m = LC_LISTENERS.get(e), ls = m && m.get('@unmount');
					if (ls) for (const fn of [...ls]) {
						try { const r = fn.call(e, e); if (r && typeof r.then === 'function') pending.push(r); }
						catch (err) { console.warn('[Instance] @unmount listener error:', err); }
					}
					/* harmonization (Pass P): the class-defined ['@unmount'] METHOD fires on the
					 * sync path too (it already fired on disposeAsync via #awaitHooks) — once-
					 * guarded by the #mounted.delete above; a thenable return gates the reclaim
					 * exactly like a listener's. */
					const hr = Lifecycle.#fire(e, '@unmount', e);
					if (hr && typeof hr.then === 'function') pending.push(hr);
				}
				Lifecycle.deregister(e, true); // teardown: no saved slot, no resurrection
				try { e[PROXIES] && e[PROXIES](TEARDOWN); } catch (err) {} // workers/sockets/listeners die with their element
				{ const _es = _EVT_SUBS.get(e); if (_es) for (const d of [..._es]) { try { d(); } catch (err) {} } } // event subscriptions drain too (Pass Q8)
				Lifecycle.#detached.delete(e);
			});
			const reclaim = () => { Lifecycle.#sweep(el, e => Lifecycle.#reclaim(e)); return el; };
			return pending.length ? Promise.all(pending).then(reclaim, reclaim) : reclaim();
		}

		// kernel bridge: dispose the element's $-field signals. Chimera's structural
		// invalidation then cascades teardown to dependents and sweeps the slots.
		static #reclaim(el) {
			const store = STORE.get(el); // Safely fetch via WeakMap
			if (!store) return;
			
			// This single loop now cleans up state, computeds, AND effects
			for (const ref of store.dict.values()) Signal.deref(ref)?.dispose();
		}

		// async detach: the destructive op WAITS for an async @removal (an exit animation).
		// Order is flipped — fire while still in place, await the promise, THEN unlink.
		static async detachAsync(el) {
			if (!doc?.contains(el)) return el;
			await Lifecycle.#awaitHooks(el, '@removal', e => e.parentElement); // fired while mounted → real parent ctx
			el.parentNode.removeChild(el);
			Lifecycle.#sweep(el, e => Lifecycle.#detached.add(e)); // mark detached, without re-firing @removal
			Lifecycle.#handledExit.add(el);
			return el;
		}

		// fire a hook across the subtree, collect any thenable returns, await them all
		static async #awaitHooks(root, key, ctxOf, mountedOnly = false) {
			const pending = [];
			Lifecycle.#sweep(root, e => {
				if (mountedOnly && !Lifecycle.#mounted.has(e)) return;
				const result = Lifecycle.#fire(e, key, ctxOf(e));
				if (result && typeof result.then === 'function') pending.push(result);
			});
			if (pending.length) await Promise.allSettled(pending); // a rejecting hook must not strand the rest
		}

		// async dispose: await an async @removal (animate out), then await async @unmount, then reclaim
		static async disposeAsync(el) {
			if (doc?.contains(el)) await Lifecycle.detachAsync(el);
			await Lifecycle.#awaitHooks(el, '@unmount', () => el, true);
			Lifecycle.#sweep(el, e => {
				Lifecycle.#mounted.delete(e);
				Lifecycle.deregister(e, true); // Q3 symmetry: the async path forgets forever too
				try { e[PROXIES] && e[PROXIES](TEARDOWN); } catch (err) {}
				{ const _es = _EVT_SUBS.get(e); if (_es) for (const d of [..._es]) { try { d(); } catch (err) {} } }
				Lifecycle.#detached.delete(e);
				Lifecycle.#reclaim(e);
			});
			return el;
		}

		// observer: the nondeterministic FALLBACK, for raw / bypassed mutations only
		static start(root) {
			root ??= doc?.documentElement;
			if (Lifecycle.#observer || !root || typeof MutationObserver === 'undefined') return; // no observer host ⇒ stay inert
			Lifecycle.#observer = new MutationObserver(Lifecycle.#onMutations);
			Lifecycle.#observer.observe(root, { childList: true, subtree: true });
		}

		static #onMutations(records) {
			for (const rec of records) {
				rec.removedNodes.forEach(node =>
					Lifecycle.#dispatch(node, Lifecycle.#handledExit, e =>
						Lifecycle.#onExit(e, e === node ? rec.target : e.parentElement)
					)
				); // rec.target = the former parent
				rec.addedNodes.forEach(node =>
					Lifecycle.#dispatch(node, Lifecycle.#handledEnter, e =>
						Lifecycle.#onEnter(e, e.parentElement)
					)
				);
			}
		}

		static #dispatch(node, handled, visit) {
			if (!node || node.nodeType !== 1) return;
			if (handled.delete(node)) return; // an explicit method already ran this transition — consume the flag, skip
			Lifecycle.#sweep(node, visit); // a raw mutation slipped past the API — run the transition now
		}

		static stop() {
			Lifecycle.#observer?.disconnect();
			Lifecycle.#observer = null;
		}

		['@insertion'](ctx) {}
		['@mount'](ctx) {}
		['@rendered']() {}
		['@removal'](ctx) {}
		['@unmount'](ctx) {}

		detach() { return Lifecycle.detach(this); }
		reattach(parent, before) { return Lifecycle.reattach(this, parent, before); }
		dispose() { return Lifecycle.dispose(this); }
		unmount() { return Lifecycle.dispose(this); }
		detachAsync()  { return Lifecycle.detachAsync(this);  }
		disposeAsync() { return Lifecycle.disposeAsync(this); }
		unmountAsync() { return Lifecycle.disposeAsync(this); }
	}

	void new Lifecycle({ target: Instance, 'proto=>proto': true }); // engine stays static; proto=>proto splices only the hooks + imperative surface

	// Explicit resource management, where the runtime supports the protocol:
	//   `using el` / `await using el` — NOT wired: the empty Symbol.dispose /
	//   asyncDispose stubs were pruned in Pass O (nothing consumed them). The
	//   explicit teardown is el.dispose(); point the protocol here if/when
	//   `using` support is wanted.
	if (typeof Symbol.dispose === 'symbol')
		Instance.prototype[Symbol.dispose] = function () {
			return this.dispose();
		};
	if (typeof Symbol.asyncDispose === 'symbol')
		Instance.prototype[Symbol.asyncDispose] = function () {
			return this.disposeAsync();
		};

	void new WellKnownSymbols({ target: Instance, 'static=>static': true, 'proto=>proto': true });

/* ═════════════════════════════════════════════════════════════════════════
 * §7+ FEATURE SURFACES — everything below this line takes ONE of three forms:
 *   class X extends Interface { … }  — a surface; `void new X({ target, … })`
 *                                       is the whole install (no graft loops)
 *   function name(…) { … }           — hoisted machinery (declaration order
 *                                       is irrelevant; nothing runs at load)
 *   void new X({ … }) / assignments   — install declarations & singleton wiring
 * NO top-level `const`/`let` is DECLARED below here: state and data live in
 * the top block; element-keyed weak state is minted once, in §3.
 * ═════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
 * §10.5 — ported API (0.87.3): collection · events · search · set · chain
 *   Shape from 0.76; guts rewired to the V17 store + 0.87 Lifecycle. Custom-element/shadow tiers dropped.
 * ════════════════════════════════════════════════════════════════════════ */
function _instEffect(element, fn) {
  const store = STORE.get(element);
  const node = new Signal.Effect(fn);
  if (store) store.dict.set('$$fx:' + (_fxSeq++), node.ref);
  return () => node.dispose && node.dispose();
}

/* ═══ §7 COLLECTION — the registry/query surface ═══
 * ONE body per verb serves BOTH faces — the typeof-this dispatch is IMPLICIT
 * in the state home, object[ELEMENTS]:
 *   this === a class (typeof 'function') → this[ELEMENTS] is the live
 *     instance registry: Div.all(), Widget.where(fn), Panel.count() …
 *   this === a Collection (typeof 'object') → this[ELEMENTS] is the captured
 *     array: Instance.from(nodes).where(fn) …
 * COLLECTION_STATIC (declared at top, assigned below) feeds the Meta
 * readStatic fallback: per-tag Metas relay only SYMBOL statics from Instance,
 * so the string-named verbs reach class receivers through that map instead. */
class Collection {
  constructor(items) {
    this[ELEMENTS] = [...items];
    /* indexable query results (ENSURE_INDEX_UID semantics, Pass Q3): c[n] for ANY n —
     * in-range hits the entry, out-of-range falls back to c[0]. A proxy rather than
     * per-index getters so arbitrary indices resolve without pre-declaration. */
    return new Proxy(this, {
      get(t, p, r) {
        if (typeof p === 'string' && p.length && p.charCodeAt(0) >= 48 && p.charCodeAt(0) <= 57 && /^\d+$/.test(p))
          return t[ELEMENTS][+p] || t[ELEMENTS][0];
        return Reflect.get(t, p, r);
      }
    });
  }
  get length() { return this[ELEMENTS].length; }
  *[Symbol.iterator]() { yield* this[ELEMENTS]; }
  toArray() { return [...this[ELEMENTS]]; }

  /* ── the verbs (dual-face; see the class docblock) ── */
  all()    { return new Collection(this[ELEMENTS] ?? []); } // one query surface: registry reads are Collections — indexable, c[n] || c[0] (Pass Q3)
  first()  { const a = this[ELEMENTS]; return a && a.length ? a[0] : null; }
  last()   { const a = this[ELEMENTS]; return a && a.length ? a[a.length - 1] : null; }
  at(n)    { const a = this[ELEMENTS]; return a ? (a.at(n) ?? null) : null; }
  has(el)  { const a = this[ELEMENTS]; return !!a && a.includes(el); }
  isEmpty(){ const a = this[ELEMENTS]; return !a || a.length === 0; }
  count()  { const a = this[ELEMENTS]; return a ? a.length : 0; }
  each(fn) { (this[ELEMENTS] ?? []).forEach(fn); return this; }
  where(fn){ return new Collection((this[ELEMENTS] ?? []).filter(fn)); }
  pick(fn) { return (this[ELEMENTS] ?? []).map(fn); }
  within(sel) { const c = typeof sel === 'string' ? (doc && doc.querySelector(sel)) : sel; return c ? (this[ELEMENTS] ?? []).filter(el => c.contains(el)) : []; }
  after(el)  { const a = this[ELEMENTS] ?? []; const i = a.indexOf(el); return i === -1 ? [] : a.slice(i + 1); }
  before(el) { const a = this[ELEMENTS] ?? []; const i = a.indexOf(el); return i === -1 ? [] : a.slice(0, i); }
  firstChildren() { return (this[ELEMENTS] ?? []).filter(el => { const p = el.previousElementSibling; return !p || !p[METADATA]; }); }
  lastChildren()  { return (this[ELEMENTS] ?? []).filter(el => { const n = el.nextElementSibling; return !n || !n[METADATA]; }); }
  orphaned()    { return (this[ELEMENTS] ?? []).filter(el => !(doc && doc.contains(el))); }
  byDocument()  { return [...(this[ELEMENTS] ?? [])].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); }
}
COLLECTION_STATIC = new Map(
  ['all','first','last','at','has','isEmpty','count','each','where','pick',
   'within','after','before','firstChildren','lastChildren','orphaned','byDocument']
  .map(k => [k, Collection.prototype[k]])); // same function objects → readStatic .bind(receiver) behavior unchanged

function _lcAdd(el, key, fn) {
  let m = LC_LISTENERS.get(el); if (!m) LC_LISTENERS.set(el, m = new Map());
  let s = m.get(key); if (!s) m.set(key, s = new Set());
  s.add(fn);
  const d = Object.getOwnPropertyDescriptor(el, key);
  if (!d || !d.value || !d.value.__lcFan) {
    const fan = function (ctx) { const set = LC_LISTENERS.get(this); const ls = set && set.get(key); if (ls) for (const f of ls) { try { f.call(this, ctx); } catch (e) { console.warn('[Instance] ' + key + ' listener error:', e); } } };
    fan.__lcFan = true;
    defineProperty(el, key, { value: fan, configurable: true, writable: true, enumerable: false });
  }
  return () => s.delete(fn);
}

function _normEvent(name) { return String(name).replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(); }

// Live same-tag list: parent ? same-localName siblings : [self]. Verbs materialize it
// first — Array's HasProperty checks (map/filter/indexOf…) can't see a prototype proxy's
// virtual indices (has traps get no receiver), so each verb runs on a real snapshot array.
function _liveList(el) {
	const p = el.parentElement; if (!p) return [el];
	const ln = el.localName, out = [];
	for (const ch of p.children) if (ch.localName === ln) out.push(ch);
	return out;
};
function _ITER_SHIM() { return _liveList(this)[Symbol.iterator](); }

/* ── ENGINE MODE (Pass F) — native-behavior augmentation, fully reversible ──
 * powerup(): splices the live-tree proxy between HTMLElement.prototype and
 * Element.prototype AND redirects native prototypes' .constructor to their
 * Instance MetaCtor (recorded for restoration). powerdown() restores both.
 * Nothing native is touched unless engine mode is on. */

function _installTree() {
	if (typeof HTMLElement === 'undefined' || _ENGINE.treeBase) return;
	const hp = HTMLElement.prototype;
	const base = Object.getPrototypeOf(hp);
	_ENGINE.hp = hp; _ENGINE.treeBase = base;
	const carrier = Object.create(base);
	defineProperty(carrier, '__instanceTree', { value: true });
	defineProperty(carrier, Symbol.species, { value: Array, configurable: false });
	const treeProxy = new Proxy(carrier, {
		get(t, prop, receiver) {
			const v = Reflect.get(t, prop, receiver);
			if (v !== undefined) return v;
			let __nt; try { __nt = receiver && receiver.nodeType; } catch (e) { __nt = 0; } // brand-safe: prototype objects / exotic receivers traverse this chain in engine shape (Pass Q6)
			if (__nt !== 1) return v;
			if (prop === Symbol.iterator) return _ITER_SHIM;
			if (typeof prop !== 'string') return v;
			const av = _ARRAY_VERBS.get(prop);
			if (av) return av;
			if (prop === 'length') return _liveList(receiver).length;
			if (/^\d+$/.test(prop)) return _liveList(receiver)[+prop];
			if (prop === receiver.localName && _NAMESPACES.has(prop)) { const nf = _nsFacade(receiver); if (nf !== undefined) return nf; }
			const tag = prop.length > 7 && prop.endsWith('Element') ? prop.slice(0, -7) : prop;
			if (/^[a-z][a-z0-9-]*$/.test(tag)) {
				for (const ch of receiver.children) if (ch.localName === tag) return ch;
			}
			return undefined;
		}
	});
	Object.setPrototypeOf(hp, treeProxy);
}
function _uninstallTree() {
	if (_ENGINE.treeBase && _ENGINE.hp) Object.setPrototypeOf(_ENGINE.hp, _ENGINE.treeBase);
	_ENGINE.treeBase = _ENGINE.hp = null;
}
function _engineSwapCtor(nativeProto, MetaCtor) {
	if (!_ENGINE.ctors.has(nativeProto))
		_ENGINE.ctors.set(nativeProto, Object.getOwnPropertyDescriptor(nativeProto, 'constructor'));
	defineProperty(nativeProto, 'constructor', { value: MetaCtor, configurable: true, enumerable: false, writable: true });
}

/* ── ELEMENT NAMESPACES (Pass I) — 0.73.d port: per-tag reactive facades served
 * at el[localName] (formEl.form, inputEl.input, …) on interface MISS, lazily
 * initialized, cached per element, cleaned on @unmount. This pass: form / input /
 * textarea / select. Mechanical extensions deferred: a, details, dialog, media. */
function _nsCleanup(el, fn) { let s = _NS_CLEAN.get(el); if (!s) _NS_CLEAN.set(el, s = new Set()); s.add(fn); }
// fan bodies resolve listeners via `this` (LC_LISTENERS.get(this)) — a detached call
// silently no-ops. Always invoke with the element as receiver (0.73's _fireLifecycleKey).
function _nsFire(el, key, ctx) { const fan = el[key]; if (typeof fan === 'function') fan.call(el, ctx); } // receiver-bound: fan bodies resolve their listeners via LC_LISTENERS.get(this)
function _nsSig(v) { return new Signal.State(v); }
function _nsRAF(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0); }
function _nsFacade(el) {
	if (_NS_CACHE.has(el)) return _NS_CACHE.get(el);
	const init = _NAMESPACES.get(el.localName);
	if (!init) return undefined;
	const f = init(el);
	_NS_CACHE.set(el, f);
	_lcAdd(el, '@unmount', () => {
		const set = _NS_CLEAN.get(el);
		if (set) { set.forEach(fn => { try { fn(); } catch (e) {} }); _NS_CLEAN.delete(el); }
		_NS_CACHE.delete(el);
	});
	return f;
}

_NAMESPACES.set('form', function initFormNamespace(el) {
	const loading   = _nsSig(false);
	const valid     = _nsSig(el.checkValidity ? el.checkValidity() : true);
	const dirty     = _nsSig(false);
	const submitted = _nsSig(false);
	const errors    = _nsSig({});
	const _values = () => Object.fromEntries([...new FormData(el)].map(([k, v]) => [k, v]));
	let _initial = {};
	const _syncValid = () => valid.set(el.checkValidity ? el.checkValidity() : true);
	const _syncDirty = () => dirty.set(JSON.stringify(_values()) !== JSON.stringify(_initial));
	const _showError = (name, message) => {
		const span = el.querySelector('[data-error="' + name + '"]');
		if (span) span.textContent = message == null ? '' : message;
	};
	const _clearErrors = () => {
		errors.set({});
		el.querySelectorAll('[data-error]').forEach(sp => { sp.textContent = ''; });
		el.querySelectorAll('.instance-field--invalid').forEach(f => {
			f.classList.remove('instance-field--invalid');
			f.classList.add('instance-field--valid');
		});
	};
	const _updateFormClasses = () => {
		const v = valid.peek(), d = dirty.peek(), l = loading.peek(), su = submitted.peek();
		el.classList.toggle('instance-form--valid', v);
		el.classList.toggle('instance-form--invalid', !v);
		el.classList.toggle('instance-form--dirty', d);
		el.classList.toggle('instance-form--pristine', !d);
		el.classList.toggle('instance-form--loading', l);
		el.classList.toggle('instance-form--submitted', su);
	};
	// NOTE: 0.73 synced classes via one effect over all four signals; under this
	// kernel's CONSENSUS default a 4-dep effect fires only when all four settle in
	// one batch — so classes sync explicitly at every mutation site instead.
	const _rules = () => (el.constructor && el.constructor.fields) || {};
	async function _validateField(name, value) {
		const rules = _rules()[name];
		if (!rules) return null;
		if (rules.match) {
			const other = new FormData(el).get(rules.match);
			if (value !== other) return rules.message != null ? rules.message : ('Must match ' + rules.match);
		}
		if (rules.validate) {
			const result = await rules.validate(value);
			if (typeof result === 'string') return result;
			if (result === false) return rules.message != null ? rules.message : 'Invalid';
		}
		return null;
	}
	async function _validateAll() {
		const data = new FormData(el);
		const errs = {};
		const native = el.checkValidity ? el.checkValidity() : true;
		if (!native) {
			[...el.elements].forEach(field => {
				if (!field.name || (field.validity && field.validity.valid)) return;
				const rules = _rules()[field.name];
				const msgKey = field.validity ? Object.keys(Object.getPrototypeOf(field.validity).constructor.prototype).find(k => k !== 'valid' && field.validity[k]) : null;
				const custom = rules && rules.messages ? rules.messages[msgKey] : undefined;
				errs[field.name] = custom != null ? custom : field.validationMessage;
			});
		}
		for (const [name, value] of data.entries()) {
			const err = await _validateField(name, String(value));
			if (err) errs[name] = err;
		}
		return errs;
	}
	const _onInput = (e) => {
		_syncValid(); _syncDirty(); _updateFormClasses();
		const field = e.target;
		if (!field || !field.name) return;
		const container = (field.closest && field.closest('[data-field]')) || field.parentElement;
		if (container) {
			container.classList.toggle('instance-field--dirty', true);
			const fv = field.validity ? field.validity.valid : true;
			container.classList.toggle('instance-field--valid', fv);
			container.classList.toggle('instance-field--invalid', !fv);
		}
		_nsFire(el, '@change', {
			field, name: field.name, value: field.value,
			valid: field.validity ? field.validity.valid : true,
			values: _values()
		});
	};
	const _onBlur = (e) => {
		const field = e.target;
		if (!field || !field.name) return;
		const container = (field.closest && field.closest('[data-field]')) || field.parentElement;
		if (container) container.classList.add('instance-field--touched');
	};
	const _onSubmit = async (e) => {
		e.preventDefault();
		submitted.set(true); loading.set(true); _updateFormClasses();
		const errs = await _validateAll();
		if (Object.keys(errs).length > 0) {
			loading.set(false); _updateFormClasses();
			errors.set(errs);
			Object.entries(errs).forEach(([name, msg]) => _showError(name, msg));
			Object.keys(errs).forEach(name => {
				const field = el.elements[name];
				const container = field && ((field.closest && field.closest('[data-field]')) || field.parentElement);
				if (container) { container.classList.add('instance-field--invalid'); container.classList.remove('instance-field--valid'); }
			});
			_nsFire(el, '@invalid', { errors: errs, fields: el.elements, first: el.querySelector(':invalid') || el.elements[Object.keys(errs)[0]] });
			return;
		}
		_clearErrors();
		_nsFire(el, '@submit', { values: _values(), valid: true, form: el, reset: () => el.reset() });
		loading.set(false); _updateFormClasses();
		el.classList.add('instance-form--success');
	};
	const _onReset = () => {
		_clearErrors(); dirty.set(false); submitted.set(false);
		valid.set(el.checkValidity ? el.checkValidity() : true); _updateFormClasses();
		el.classList.remove('instance-form--success', 'instance-form--error');
		_nsFire(el, '@reset', { form: el });
		_nsRAF(() => { _initial = _values(); });
	};
	el.addEventListener('input',  _onInput, { passive: true });
	el.addEventListener('change', _onInput, { passive: true });
	el.addEventListener('blur',   _onBlur,  { capture: true, passive: true });
	el.addEventListener('submit', _onSubmit);
	el.addEventListener('reset',  _onReset, { passive: true });
	_nsRAF(() => { _initial = _values(); });
	_updateFormClasses();
	_nsCleanup(el, () => {
		el.removeEventListener('input',  _onInput);
		el.removeEventListener('change', _onInput);
		el.removeEventListener('blur',   _onBlur, { capture: true });
		el.removeEventListener('submit', _onSubmit);
		el.removeEventListener('reset',  _onReset);
	});
	return Object.freeze({
		loading, valid, dirty, submitted, errors,
		validate:    () => _validateAll().then(errs => Object.keys(errs).length === 0),
		values:      _values,
		setValue:    (name, value) => { const f = el.elements[name]; if (f) { f.value = value; f.dispatchEvent(new Event('input', { bubbles: true })); } },
		setError:    (name, msg) => { errors.set(Object.assign({}, errors.peek(), { [name]: msg })); _showError(name, msg); },
		clearErrors: _clearErrors,
		focus:       (name) => { const f = el.elements[name]; if (f && f.focus) f.focus(); }
	});
});

function _nsControl(events) {
	return function initControlNamespace(el) {
		const value   = _nsSig(el.value != null ? el.value : '');
		const valid   = _nsSig(el.validity ? el.validity.valid : true);
		const touched = _nsSig(false);
		const dirty   = _nsSig(false);
		const _initial = el.value != null ? el.value : '';
		const _onIn = () => { value.set(el.value); valid.set(el.validity ? el.validity.valid : true); dirty.set(el.value !== _initial); };
		const _onBlur = () => touched.set(true);
		events.forEach(t => el.addEventListener(t, _onIn, { passive: true }));
		el.addEventListener('blur', _onBlur, { passive: true });
		_nsCleanup(el, () => { events.forEach(t => el.removeEventListener(t, _onIn)); el.removeEventListener('blur', _onBlur); });
		return Object.freeze({ value, valid, touched, dirty });
	};
}
_NAMESPACES.set('input',    _nsControl(['input', 'change']));
_NAMESPACES.set('textarea', _nsControl(['input']));
_NAMESPACES.set('select',   _nsControl(['change']));

/* ═══ §10 ROUTER (Pass H engine, UNIFIED in Pass P) — ONE class, two faces.
 *
 *   Router.navigate('/x') · Router.back() · Router.before(fn) · Router.current …
 *     — the engine, ALL static: parse/compile/match tables, history wiring
 *       (push | hash | memory), guards as middleware (fn(from, to, next):
 *       next() proceeds, next('/path') redirects, silence blocks), commits
 *       into registered outlets. State is the top-level _RT record; the old
 *       frozen singleton's prototype face lives here verbatim — with one
 *       class there is nothing left to instantiate for the API.
 *
 *   <router base=… history=…><route path=… src=…/></router>
 *     — the element: an Instance whose ['@mount'] configures the engine from
 *       attributes, compiles <route> children into the table (extra named
 *       route-attributes target named outlets), watches childList for table
 *       edits, and delegates its anchor clicks. Detach-honest: ['@removal']
 *       unregisters (a detached router must not commit into a gone tree),
 *       ['@insertion'] re-registers, ['@unmount'] is final.
 *
 * Machinery statics (parse/compile/match/push/_navigate/commit/wire) stay
 * PUBLIC — Events' el.route() and the element face drive them from outside.
 * router.path is a kernel Signal MINTED EAGERLY in _register: a lazy first
 * mint inside a running effect would be adopted by that effect and disposed
 * on its re-run (the zombie-handle trap, see the Pass-H checkpoint). */
class Router extends Instance {

	/* — element face — */
	#childObs = null;
	['@mount']() {
		Router.configure({ base: this.getAttribute('base') || '', history: this.getAttribute('history') || 'push' });
		this.#registerAll();
		this.#childObs = new MutationObserver(() => this.#registerAll());
		this.#childObs.observe(this, { childList: true });
		this.addEventListener('click', e => {
			const anchor = e.target && e.target.closest && e.target.closest('a[href]');
			if (!anchor) return;
			const href = anchor.getAttribute('href');
			if (!href || /^(https?:|\/\/|mailto:|tel:)/.test(href)) return;
			e.preventDefault();
			Router.navigate(href);
		}, false);
	}
	['@removal']() { this.#unregister(); } // detach-honest: never commit into a gone tree
	['@insertion']() { if (LC_MOUNTED.has(this)) this.#registerAll(); } // re-entry restores the table (@mount owns the first)
	['@unmount']() {
		if (this.#childObs) { this.#childObs.disconnect(); this.#childObs = null; }
		this.#unregister();
	}
	#buildRouteMap() {
		const routes = [...this.querySelectorAll('route')];
		const routeMap = {}, namedMaps = {};
		routes.forEach(route => {
			const path = route.getAttribute('path');
			if (!path) return;
			const src = route.getAttribute('src');
			const namedAttrs = [...route.attributes].filter(a => a.name !== 'path' && a.name !== 'src');
			namedAttrs.forEach(a => { if (!namedMaps[a.name]) namedMaps[a.name] = {}; namedMaps[a.name][path] = a.value; });
			if (src) routeMap[path] = src;
		});
		return { routeMap, namedMaps };
	}
	#registerAll() {
		const { routeMap, namedMaps } = this.#buildRouteMap();
		const defaultOutlet = document.querySelector('outlet:not([name])') || document.querySelector('outlet') || document.querySelector('[data-outlet]');
		if (defaultOutlet && Object.keys(routeMap).length) Router._register(defaultOutlet, routeMap, {});
		Object.entries(namedMaps).forEach(([name, map]) => {
			const outlet = document.querySelector('outlet[name="' + name + '"]');
			if (outlet && Object.keys(map).length) Router._register(outlet, map, {});
		});
	}
	#unregister() {
		const d = document.querySelector('outlet:not([name])') || document.querySelector('outlet');
		if (d) Router._unregister(d);
	}

	/* — public engine face (verbatim from the old singleton's prototype) — */
	static configure(opts) { Object.assign(_RT.config, opts || {}); return Router; }
	static navigate(path, opts) { Router.push(path, !!(opts && opts.replace)); return Router; }
	static back()    { history.back();    return Router; }
	static forward() { history.forward(); return Router; }
	static before(fn) { if (typeof fn === 'function') _RT.guards.push(fn); return Router; }
	static on(ev, fn)  { if (_RT.listeners[ev]) _RT.listeners[ev].add(fn); return Router; }
	static off(ev, fn) { if (_RT.listeners[ev]) _RT.listeners[ev].delete(fn); return Router; }
	static get current() { return Object.assign({}, _RT.current); }
	static get path() { if (!_RT.path) _RT.path = new Signal.State(_RT.current.path); return _RT.path; }
	static _unregister(outlet) { _RT.tables.delete(outlet); return Router; }
	static _register(outlet, routeMap, options) {
		const table = [];
		for (const pattern of Object.keys(routeMap))
			table.push({ pattern, compiled: Router.compile(pattern), source: routeMap[pattern], options: options || {} });
		_RT.tables.set(outlet, table);
		// mint the path signal HERE — outside any consumer. A lazy first mint inside
		// a running effect would be ADOPTED by that effect and disposed on its re-run
		// (effect-owned children are cleaned per run) — the zombie-handle trap.
		if (!_RT.path) _RT.path = new Signal.State(_RT.current.path);
		Router.wire();
		return Router;
	}

	/* — machinery (navigate → _navigate: that name now belongs to the public face) — */
	static parse(full) {
		const u = new URL(full, (typeof location !== 'undefined' && location.origin && location.origin !== 'null' && location.origin) || 'http://x'); // about:blank / sandboxed frames report the STRING 'null' — truthy, invalid as a base
		const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
		return { path: u.pathname || '/', query, hash: u.hash ? u.hash.slice(1) : '' };
	}
	static compile(pattern) {
		const names = [];
		const rx = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '(?<wild>.*)')
			.replace(/:(\w+)/g, (_, n) => { names.push(n); return '(?<' + n + '>[^/]+)'; });
		return { rx: new RegExp('^' + rx + '/?$'), names };
	}
	static match(compiled, path) {
		const m = compiled.rx.exec(path);
		if (!m) return null;
		const out = {};
		if (m.groups) for (const k of Object.keys(m.groups)) if (m.groups[k] !== undefined) out[k] = decodeURIComponent(m.groups[k]);
		return out;
	}
	static push(path, replace) {
		const c = _RT.config;
		if (c.history === 'hash') { if (replace) location.replace('#' + path); else location.hash = path; }
		else if (c.history === 'memory') { Router._navigate(path); }
		else {
			const full = c.base + path;
			if (replace) history.replaceState({}, '', full); else history.pushState({}, '', full);
			Router._navigate(path);
		}
	}
	static _navigate(pathOrFull, fromPopstate) {
		const parsed = _RT.config.history === 'hash'
			? Router.parse((location.hash && location.hash.slice(1)) || '/')
			: Router.parse(pathOrFull);
		const from = Object.assign({}, _RT.current);
		const to = { path: parsed.path, query: parsed.query, hash: parsed.hash, params: {} };
		const guards = _RT.guards.slice(); let i = 0;
		(function next(redirect) {
			if (redirect && typeof redirect === 'string') { Router.push(redirect, false); return; }
			if (i < guards.length) { guards[i++](from, to, next); return; }
			Router.commit(from, to, parsed, !!fromPopstate);
		})();
	}
	static commit(from, to, parsed, fromPopstate) {
		let matched = null, matchParams = {}, matchOutlet = null, matchSource = null;
		for (const [outlet, table] of _RT.tables) {
			for (const entry of table) {
				const params = Router.match(entry.compiled, parsed.path);
				if (params !== null) {
					matched = entry; matchParams = params; matchOutlet = outlet;
					matchSource = typeof entry.source === 'function' ? entry.source.call(outlet, params, parsed) : entry.source;
					break;
				}
			}
			if (matched) break;
		}
		if (!matched) { _RT.listeners.error.forEach(fn => { try { fn(new Error('No route matched: ' + parsed.path)); } catch (e) {} }); return; }
		to.params = matchParams;
		_RT.current = Object.assign({}, to);
		if (_RT.path) _RT.path.set(parsed.path);
		if (_RT.config.scroll && !fromPopstate && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
		const ctx = { from, to, params: matchParams, query: parsed.query, hash: parsed.hash };
		if (matchOutlet && typeof matchOutlet['@routeleave'] === 'function') matchOutlet['@routeleave'](ctx);
		const _after = () => {
			if (typeof matchOutlet['@routeenter'] === 'function') matchOutlet['@routeenter'](Object.assign({ el: matchOutlet }, ctx));
			if (typeof matchOutlet['@navigate'] === 'function') matchOutlet['@navigate'](ctx);
			_RT.listeners.navigate.forEach(fn => { try { fn(from, to); } catch (e) {} });
		};
		if (matchSource instanceof Node) { matchOutlet.innerHTML = ''; matchOutlet.appendChild(matchSource); _after(); }
		else if (typeof matchSource === 'string' && _looksLikeURL(matchSource))
			Promise.resolve(typeof matchOutlet.get === 'function' ? matchOutlet.get(matchSource) : _httpGET(matchSource))
				.then(html => { matchOutlet.innerHTML = String(html); _after(); }, () => _after());
		else _after();
	}
	static wire() {
		if (_RT.wired || typeof document === 'undefined') return;
		_RT.wired = true;
		document.addEventListener('click', (e) => {
			const anchor = e.target && e.target.closest && e.target.closest('a[href]');
			if (!anchor) return;
			const inRouter = anchor.closest('[data-router]');
			const href = anchor.getAttribute('href');
			if (!href || /^(https?:|\/\/|mailto:|tel:)/.test(href)) return;
			if (!inRouter) {
				let known = false;
				for (const [, table] of _RT.tables) for (const entry of table) if (Router.match(entry.compiled, Router.parse(href).path)) { known = true; break; }
				if (!known) return;
			}
			e.preventDefault();
			Router.push(href, false);
		}, false);
		if (typeof window !== 'undefined') {
			window.addEventListener('popstate', () => Router._navigate(location.pathname + location.search + location.hash, true));
			window.addEventListener('hashchange', () => { if (_RT.config.history === 'hash') Router._navigate((location.hash && location.hash.slice(1)) || '/'); });
		}
	}
}
void Instance.define(Router); // <router> joins the vocabulary index
_ROUTER = Router; // the class IS the API — every _ROUTER.x call site resolves to a static.
// NOT frozen (the old singleton was): the first mint rebases Router onto its
// Meta via setPrototypeOf — a frozen class would make <router> unconstructible.


/* ── TRANSITIONS (Pass L) — 0.73 port: Web Animations with a deterministic CSS
 * fallback (no el.animate → apply final frame; also the jsdom path). Resolution:
 * object config · '::name' → class static shadow.transitions · name → class static
 * transitions → BUILT_INS. Dedupe per el×fullKey via ACTIVE_TR. Meta start/end
 * fire the '@transition' lifecycle fan (':name' is reserved by the Pass-D
 * reflection sugar — collision found in battery; 0.73's handler-map face replaced). */

function _trCss(frame) {
	const css = {};
	for (const k of Object.keys(frame)) {
		const v = frame[k];
		if (k === 'y')     { css.transform = ((css.transform || '') + ' translateY(' + (typeof v === 'number' ? v + 'px' : v) + ')'); continue; }
		if (k === 'x')     { css.transform = ((css.transform || '') + ' translateX(' + (typeof v === 'number' ? v + 'px' : v) + ')'); continue; }
		if (k === 'scale') { css.transform = ((css.transform || '') + ' scale(' + v + ')'); continue; }
		if (k === 'blur')  { css.filter = 'blur(' + (typeof v === 'number' ? v + 'px' : v) + ')'; continue; }
		css[k] = typeof v === 'number' && k !== 'opacity' ? v + 'px' : String(v);
	}
	if (css.transform) css.transform = css.transform.trim();
	return css;
}
function _trResolve(el, name) {
	if (name && typeof name === 'object') return name;
	const raw = String(name);
	const shadow = raw.startsWith('::');
	const core = shadow ? raw.slice(2) : raw;
	const Klass = el.constructor;
	if (shadow) {
		const sh = Klass && Klass.shadow;
		const cfg = sh && typeof sh === 'object' && sh.transitions && sh.transitions[core];
		if (cfg) return Object.assign({}, cfg, { _name: core, _scope: 'shadow' });
	} else {
		const cfg = Klass && Klass.transitions && Klass.transitions[core];
		if (cfg) return Object.assign({}, cfg, { _name: core, _scope: 'local' });
		if (BUILT_INS[core]) return Object.assign({}, BUILT_INS[core], { _name: core, _scope: 'builtin' });
	}
	if (Instance.debug) console.warn("[Instance] transition '" + raw + "' not found");
	return null;
}
function _trRun(target, config) {
	return new Promise((resolve) => {
		const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const applyFinal = () => { const f = _trCss(config && config.to || {}); for (const k of Object.keys(f)) target.style[k] = f[k]; };
		if (!config || reduced) { if (config && config.to) applyFinal(); resolve(target); return; }
		const fromCSS = _trCss(config.from || {});
		const toCSS = _trCss(config.to || {});
		const opts = { duration: config.duration != null ? config.duration : 200, delay: config.delay || 0, easing: config.easing || 'ease', fill: 'forwards' };
		try {
			const a = target.animate([fromCSS, toCSS], opts);
			a.onfinish = () => resolve(target);
			a.oncancel = () => resolve(target);
		} catch (e) { applyFinal(); resolve(target); }
	});
}

/* ═══ §13 THE BUILT-IN ELEMENT VOCABULARY (Pass P) — every semantic tag is an
 * Instance class. This region REPLACES the initXElement function family and its
 * SEMANTIC_HANDLERS dispatch table: construction is registration (void
 * Instance.define(Klass) indexes the tag), the boot ring below upgrades what the
 * parser already produced, and lifecycle rides the real hooks — ['@mount'] runs
 * the old init body exactly once (LC_MOUNTED), ['@unmount'] is the teardown that
 * the old code leaked outside one hardcoded observer branch, and live elements
 * honor detach semantics (['@removal'] pauses, ['@insertion'] resumes) instead
 * of dying on raw removal. `new Async()` etc. work programmatically like any
 * other Instance class; declarative upgrading of USER classes is ⚡⚡ super mode,
 * while THIS vocabulary (CORE_TAGS) boots unconditionally — pages that use
 * <router> or <intl> today keep working with no flag. */

/* — helpers shared by the vocabulary (hoisted machinery) — */
function _applyIntl(el) {
	const key = el.getAttribute && el.getAttribute('key');
	if (!key || !_I18N) return;
	const val = _I18N[key];
	if (val != null) el.textContent = val;
}
/* swap an element's text for a generated <a> — the email/tel/website decorator core */
function _inlineLink(el, hrefFn, rel) {
	const text = (el.textContent || '').trim();
	if (!text) return;
	const a = document.createElement('a');
	a.href = hrefFn(text);
	if (rel) a.rel = rel;
	a.textContent = text;
	el.textContent = ''; el.appendChild(a);
}
/* button semantics for non-button tags: role, focusability, Enter/Space → click */
function _activatable(el, onFire) {
	el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
	el.addEventListener('click', onFire);
	el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
}

/* — decorators: one-shot @mount work, no teardown state — */
class Static extends Instance {
	['@mount']() { this.setAttribute('data-static', ''); }
}
class Email extends Instance {
	['@mount']() { _inlineLink(this, t => 'mailto:' + t, null); }
}
class Tel extends Instance {
	['@mount']() { _inlineLink(this, t => 'tel:' + t.replace(/\s/g, ''), null); }
}
class Website extends Instance {
	['@mount']() { _inlineLink(this, t => t.startsWith('http') ? t : 'https://' + t, 'external noopener noreferrer'); }
}
class Mailto extends Instance {
	['@mount']() {
		const to = this.getAttribute('to') || '', subject = this.getAttribute('subject') || '', body = this.getAttribute('body') || '';
		const params = new URLSearchParams();
		if (subject) params.set('subject', subject);
		if (body) params.set('body', body);
		const query = params.toString();
		const a = document.createElement('a');
		a.href = 'mailto:' + to + (query ? '?' + query : '');
		a.innerHTML = this.innerHTML || to;
		this.innerHTML = ''; this.appendChild(a);
	}
}
class Logout extends Instance {
	['@mount']() {
		this.style.cursor = 'pointer';
		_activatable(this, () => {
			const endpoint = this.getAttribute('href') || this.getAttribute('action') || '/api/logout';
			const redirect = this.getAttribute('redirect') || '/';
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			Promise.resolve(F ? F(endpoint, { method: 'POST' }) : null).then(() => { try { Router.navigate(redirect); } catch (e) { location.href = redirect; } });
		});
	}
}
class Reset extends Instance {
	['@mount']() { _activatable(this, () => { const form = this.closest('form'); if (form) form.reset(); }); }
}
class Portal extends Instance {
	['@mount']() {
		const target = document.querySelector(this.getAttribute('target') || 'body');
		if (!target) return;
		const frag = document.createDocumentFragment();
		[...this.childNodes].forEach(n => frag.appendChild(n));
		target.appendChild(frag);
		this._portalTarget = target;
	}
}
/* <intl key=…> — class named IntlElement (bare `Intl` would shadow ECMA-402
 * inside this scope); static id claims the tag. Instance.i18n() re-applies
 * translations across every <intl>, upgrading any the boot ring hasn't met. */
class IntlElement extends Instance {
	static id = 'intl';
	['@mount']() { _applyIntl(this); }
}

/* — live elements: real teardown via ['@unmount'], detach-honest pause/resume — */

/* <async src=…> — one-shot remote include. inert until settled; JSON payloads
 * fan '@async' on the parent and leave the element; HTML/text replaces it.
 * src is live (attribute observer refetches); .reload() forces. Teardown is
 * ['@unmount'] — under the old init this observer leaked unless the removal
 * happened to cross the semantic-boot observer's hardcoded branch. */
class Async extends Instance {
	#obs = null;
	['@mount']() {
		this.setAttribute('inert', '');
		const src = this.getAttribute('src');
		if (src) this.#fetch(src);
		this.#obs = new MutationObserver(ms => { ms.forEach(m => { if (m.attributeName === 'src') { const ns = this.getAttribute('src'); if (ns) this.#fetch(ns); } }); });
		this.#obs.observe(this, { attributes: true, attributeFilter: ['src'] });
	}
	['@unmount']() { if (this.#obs) { this.#obs.disconnect(); this.#obs = null; } }
	reload() { const u = this.getAttribute('src'); if (u) this.#fetch(u); return this; }
	async #fetch(url) {
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const response = await F(url);
			const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
			let nodes = [];
			if (contentType.includes('application/json')) {
				const data = await response.json();
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src: url, data, el: this, type: 'json' });
				this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
				return;
			}
			if (contentType.startsWith('text/')) {
				const html = await response.text();
				const template = document.createElement('template');
				template.innerHTML = html;
				nodes = [...template.content.childNodes];
			}
			this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
			const parent = this.parentElement;
			if (nodes.length) this.replaceWith(...nodes); else this.replaceWith();
			if (parent) _nsFire(parent, '@async', { src: url, nodes, el: this, type: 'html' });
		} catch (err) {
			this.setAttribute('data-error', ''); this.removeAttribute('inert');
			const errChild = this.querySelector(':scope > error');
			if (errChild) errChild.style.display = '';
			else console.warn('[Instance] <async> fetch failed: ' + err.message + ' (' + url + ')');
			const parent = this.parentElement;
			if (parent) _nsFire(parent, '@async', { src: url, error: err, el: this, type: 'error' });
		}
	}
}

/* <sync src=… interval=…> — polling remote include. DETACH-HONEST: raw removal
 * used to KILL it via the hardcoded observer branch; now ['@removal'] merely
 * pauses the timer and ['@insertion'] resumes it (remove ≠ destroy), while
 * ['@unmount'] — dispose(), the only real teardown — stops it for good. This
 * closes the old leak the other way around too: a <sync> torn down through
 * dispose() previously kept polling forever. */
class Sync extends Instance {
	#timer = null; #last = '';
	['@mount']() { this.#start(); }
	['@insertion']() { if (LC_MOUNTED.has(this)) this.#start(); } // resume on re-entry (mount handles the first)
	['@removal']() { this.#stop(); } // pause — raw removal is detach, not death
	['@unmount']() { this.#stop(); }
	stop()  { this.#stop(); return this; }
	start() { this.#start(); return this; }
	#stop() { if (this.#timer) { clearInterval(this.#timer); this.#timer = null; } }
	#start() {
		if (this.#timer) return;
		const interval = parseInt(this.getAttribute('interval') || '5000', 10);
		this.#poll();
		this.#timer = setInterval(() => this.#poll(), interval);
	}
	async #poll() {
		const src = this.getAttribute('src');
		if (!src) return;
		this.setAttribute('data-syncing', '');
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const r = await F(src, { cache: 'no-store' });
			const text = await r.text();
			if (text !== this.#last) {
				this.#last = text;
				this.innerHTML = text;
				this.removeAttribute('data-error');
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src, el: this, type: 'sync' });
			}
		} catch (e) { this.setAttribute('data-error', ''); }
		this.removeAttribute('data-syncing');
	}
}

/* <route path=… src=…> — declarative table row; data carried by attributes,
 * read by the parent <router>. */
class Route extends Instance {}
/* <outlet name?> — a commit target; the data-outlet mirror keeps the pre-Pass-P
 * selector contract for anything querying [data-outlet]. */
class Outlet extends Instance {
	['@mount']() { this.setAttribute('data-outlet', this.getAttribute('name') || ''); }
}

void Instance.define(Static); void Instance.define(Email); void Instance.define(Tel);
void Instance.define(Website); void Instance.define(Mailto); void Instance.define(Logout);
void Instance.define(Reset); void Instance.define(Portal); void Instance.define(IntlElement);
void Instance.define(Async); void Instance.define(Sync); void Instance.define(Route); void Instance.define(Outlet);

/* ── TEMPLATE APPS (Pass M) — the scoped container:
 *   <template app='name'><script>…</script><style>…</style><section>…</section></template>
 * → an Instance class (pascalized, registered) whose every instance is a div[app]
 * host with an OPEN SHADOW ROOT: styles shadow-scoped by construction, content
 * cloned per instance, scripts EXTRACTED (never parser-run) and executed scoped —
 * this = host, with ($, app, host, shadow, Instance) in hand; instance-typed
 * scripts route through the Compiler. The template site becomes the first
 * instance; the class is reusable (new Name() anywhere — each with its own
 * shadow + its own reactive store). Klass.shadow.{transitions} is ensured, so
 * '::name' resolution has its home (the shadow transition contract). */
/* ── ⚡⚡ super-mode machinery — the document-wide declarative sweep. Both walk
 * the LIGHT tree only: querySelectorAll never descends into template.content or
 * shadow roots, which is correct — template content is inert by definition and
 * shadow scopes run their own adoption (template apps). Idempotence rides
 * upgrade()'s LEAF guard, so re-sweeps and overlap with the core boot ring are
 * free. */
function _superSweep(root) {
	if (!root || !root.querySelectorAll) return;
	for (const el of root.querySelectorAll('*')) if (CUSTOM_TAGS.has(el.localName)) Instance.upgrade(el);
}
function _superWalk(node) {
	if (!node || node.nodeType !== 1) return;
	if (CUSTOM_TAGS.has(node.localName)) Instance.upgrade(node);
	_superSweep(node);
}

function _adoptClaim(selector) {
	if (_UPGRADE) { const n = _UPGRADE; _UPGRADE = null; CLAIMED.add(n); return n; } // in-place upgrade: the node IS the adoption — no scope, no query
	if (!_ADOPT) return null;
	let nodes; try { nodes = _ADOPT.querySelectorAll(selector); } catch (e) { return null; }
	for (const n of nodes) if (!CLAIMED.has(n)) { CLAIMED.add(n); return n; }
	return null;
}
function _pascal(n) { return String(n).split(/[-_\s]+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(''); }
/* <template app='Name'> — the class-definition context (Pass N model):
 * the template becomes a div[app] host with an OPEN shadow (styles + markup
 * scoped by construction). Its <script>s run ONCE, this = the container, and
 * are expected to DEFINE the class (initialization belongs in the constructor).
 * Scripts compile through the Instance Compiler by default (no type= needed —
 * %Name and the sigils just work; plain JS passes through). Instances minted
 * inside ADOPT matching pre-populated markup in the shadow — the element IS
 * the instance, so adoption is a proto-splice on the existing node; JS
 * structure takes precedence on conflicts; fresh instances append to the
 * scope. The class stays ISOLATED unless `static global = true`; other
 * contexts reach it via Instance.app('Name') — in compiled code, %Name. */
function initTemplateApp(el) {
	if (!el.hasAttribute || !el.hasAttribute('app')) return; // plain <template>s untouched
	if (el._instanceAppInit) return; el._instanceAppInit = true;
	const name = el.getAttribute('app');
	if (!name) return;
	if (!globalThis.Div) { // classes not yet registered — retry after boot settles
		el._instanceAppInit = false;
		Promise.resolve(globalThis.InstanceReady).then(() => initTemplateApp(el));
		return;
	}
	const host = doc.createElement('div');
	host.setAttribute('app', name);
	const shadow = host.attachShadow({ mode: 'open' });
	const frag = doc.importNode(el.content, true);
	const scripts = [...frag.querySelectorAll('script')];
	scripts.forEach(sc => sc.remove()); // never parser-run
	shadow.appendChild(frag);
	el.replaceWith(host);
	const ident = /^[A-Za-z_$][\w$]*$/.test(name) ? name : _pascal(name);
	const prevAdopt = _ADOPT; _ADOPT = shadow;
	let Klass;
	for (const sc of scripts) {
		let code = sc.textContent || '';
		if (Instance.Compiler) { try { code = Instance.Compiler.compile(code).code; } catch (e) { /* plain JS: run as written */ } }
		try {
			const fn = new Function('app', 'host', 'shadow', 'Instance',
				'"use strict";\n' + code + '\n;return (typeof ' + ident + " !== 'undefined') ? " + ident + ' : undefined;');
			const K = fn.call(host, host, host, shadow, Instance);
			if (typeof K === 'function') Klass = K;
		} catch (e) { console.warn('[Instance] app "' + name + '" script error: ' + e.message); }
	}
	_ADOPT = prevAdopt;
	if (Klass) {
		APPS.set(name, Klass); // %Name / Instance.app(name) — the isolation bridge
		if (Klass.global === true) {
			if (!(name in globalThis)) globalThis[name] = Klass;
			else console.warn('[Instance] app class name taken — registry-only: ' + name);
		}
	}
}


/* ─── the boot ring — wake the parsed document's built-in vocabulary. Runs
 * UNCONDITIONALLY (pages using <router>/<intl> today need no flag); ⚡⚡ super
 * mode extends the identical machinery to user classes via its own sweep +
 * observer. Routers upgrade first (they configure the engine and register
 * outlets), then outlets, then the rest; template apps stay bespoke — a class
 * definition context is not an element upgrade (Pass P decision). Removals are
 * deliberately NOT handled here: raw removal is detach (a paused <sync> is a
 * live <sync>), and dispose() — the only real teardown — already fires
 * ['@unmount'] through Lifecycle. The three hardcoded cleanup calls this
 * replaces both leaked (dispose never ran them) and over-killed (raw removal
 * destroyed permanently). */
function _bootWalk(node) {
	if (!node || node.nodeType !== 1) return;
	if (node.localName === 'template') { initTemplateApp(node); return; } // [app] guard lives in the init; plain templates untouched; content is inert — never descend
	if (CORE_TAGS.has(node.localName)) Instance.upgrade(node);
	node.childNodes.forEach(_bootWalk);
}
function _elementBoot() {
	try { document.head && document.head.appendChild(Object.assign(document.createElement('style'), { textContent: 'intl{display:inline}' })); } catch (e) {}
	document.querySelectorAll('router').forEach(el => Instance.upgrade(el));
	document.querySelectorAll('outlet').forEach(el => Instance.upgrade(el));
	for (const tag of CORE_TAGS) if (tag !== 'router' && tag !== 'outlet') document.querySelectorAll(tag).forEach(el => Instance.upgrade(el));
	document.querySelectorAll('template[app]').forEach(initTemplateApp);
	const root = document.body || document.documentElement;
	if (!root || root._instanceElementObs) return;
	root._instanceElementObs = true;
	new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(_bootWalk))).observe(root, { childList: true, subtree: true });
}
if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _elementBoot, { once: true });
	else _elementBoot();
}

function _looksLikeURL(k) { return /^(?:https?:\/\/|\/\/|\.{0,2}\/)/.test(k); }
// The single network-GET seam — await-import interop upgrades HERE (module URLs →
// dynamic import) without touching get()'s routing. Deferred by design (0.87.h).
function _httpGET(url, opts) {
	const F = typeof fetch === 'function' ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
	if (!F) return Promise.reject(new Error('[Instance] get(url): no fetch in this environment'));
	return Promise.resolve(F(url, opts)).then(r => {
		const ct = (r && r.headers && r.headers.get && r.headers.get('content-type')) || '';
		return ct.includes('json') ? r.json() : r.text();
	});
}

function _evStore(el) { let s = _EV.get(el); if (!s) _EV.set(el, s = []); return s; }

function _isThenable(v) { return v != null && typeof v.then === 'function'; }
// Run handler, then afterFn (finally-style): afterFn ALWAYS runs and receives (returnValue, {e, time, count,
// error}); the handler's error and afterFn's own error each surface via _surface (handler first), so neither
// clobbers the other. Sync handler -> afterFn fires immediately; thenable handler -> after it settles. Never throws.
function _withAfter(target, e, delegateTarget, handler, afterFn, ctr) {
  const time = Date.now();                 // ms since epoch (for POSIX seconds: Math.floor(Date.now() / 1000))
  const count = ++ctr.n;                   // per-listener fire counter, 1-based
  let value, errH;
  try { value = handler.call(target, e, delegateTarget); }
  catch (err) { errH = err; }
  const after = (val, error) => {
    let errA, ret;
    try { ret = afterFn.call(target, val, { e, time, count, error }); }
    catch (err) { errA = err; }
    if (error) _surface(error);            // handler error — primary, surfaced first
    if (errA) _surface(errA);              // afterFn's own error — separate, never eats the handler's
    if (_isThenable(ret)) ret.then(undefined, _surface); // afterFn async rejection, same channel
  };
  if (_isThenable(value)) value.then(v => after(v, undefined), err => after(undefined, err));
  else after(errH ? undefined : value, errH);
}

/* ═══ §8 EVENTS — the element event surface ═══
 * The on/off/once tiers (native · '#'/'##' hot-swap · '::' shadow fan · '@'
 * lifecycle fans · ':name' reflection sugar), the meta channels
 * (:addition/:removal), the universal verbs (get/has/remove/batch/subscribe/
 * notify/inspect), bind/callbind, and the transition surface (machinery in
 * §11). Overloads normalize their arguments on the first lines of each body
 * — typeOrConds may be an event name, a '$key' map, or a conditions object;
 * selOrFn is a delegation selector or the handler itself.
 *
 * STATE: _EV (tier bookkeeping) · _SUBS (observers) · LC_LISTENERS (fan
 * bodies) · ACTIVE_TR (transition dedupe) — every one minted in the §3
 * Symbols block (the single weak-state mint) and aliased at the file top.
 *
 * INSTALL: the `void new Events(…)` declaration below — Interface splices
 * this prototype onto Instance.prototype with descriptors mirrored 1:1
 * (class methods are non-enumerable/writable/configurable, exactly what the
 * old graft loop wrote), and every per-tag iface relays from there. */
class Events extends Interface {

  trigger(event, detail = null, options = {}) {
    const type = _normEvent(event);
    const native = typeof window !== 'undefined' && ('on' + type) in window;
    const evt = native
      ? new Event(type, { bubbles: true, cancelable: true, ...options })
      : new CustomEvent(type, { bubbles: true, composed: true, cancelable: false, detail: detail ?? {}, ...options });
    this.dispatchEvent(evt);
    return this;
  }
  emit(...a) { return this.trigger(...a); }
  /* notify — the universal-verb face: fan out to subscribe()d observers; the
   * (type, listener[, depth]) shape ALSO feeds the Pass-D meta channels. */
  notify(...args) {
    const subs = _SUBS.get(this);
    if (subs) for (const cb of [...subs]) { try { cb.apply(this, args); } catch (e) { console.warn('[Instance] notify subscriber error:', e); } }
    if (typeof args[0] === 'string' && typeof args[1] === 'function')
      this.emit(':'.repeat(typeof args[2] === 'number' ? args[2] : 1) + 'addition', { type: args[0], listener: args[1] });
    return this;
  }
  subscribe(a, b, c) { // Pass Q8b overload: subscribe(ParentClass, '$field' | getter, cb) — '@change' semantics with the class explicit
    if (typeof a === 'function' && typeof c === 'function'
        && (typeof b === 'function' || (typeof b === 'string' && (b[0] === '$' || b[0] === 'Δ')))) {
      const read = typeof b === 'function' ? b : () => a[b];
      let first = true;
      return _instEffect(this, () => { const v = read.call(this); if (first) { first = false; return; } c.call(this, v, this); });
    }
    const cb = a;
    if (typeof cb !== 'function') return this; let set = _SUBS.get(this); if (!set) _SUBS.set(this, set = new Set()); set.add(cb); return () => set.delete(cb); }
  unsubscribe(cb) { const set = _SUBS.get(this); if (set) { if (cb) set.delete(cb); else set.clear(); } return this; }
  _wireStandardInterceptors() {
    if (this.__stdWired) return this;
    try { defineProperty(this, '__stdWired', { value: true, configurable: true }); } catch (e) { this.__stdWired = true; }
    const add = this.addEventListener.bind(this), rem = this.removeEventListener.bind(this);
    defineProperty(this, 'addEventListener', { configurable: true, writable: true,
      value: (t, l, o) => { add(t, l, o); if (!_inOn) this.emit(':addition', { type: t, listener: l, options: o }); } });
    defineProperty(this, 'removeEventListener', { configurable: true, writable: true,
      value: (t, l, o) => { rem(t, l, o); this.emit(':removal', { type: t, listener: l, options: o }); } });
    return this;
  }
  effect(fn) { _instEffect(this, fn); return this; }

  /* ── 0.73.w ports (Pass C): once · bind · callbind ── */

  once(typeOrConds, selOrFn, fnArg) {
    let sel = null, cb = selOrFn;
    if (typeof selOrFn === 'string') { sel = selOrFn; cb = fnArg; }
    if (typeof cb !== 'function') return this;
    if (typeOrConds !== null && typeof typeOrConds === 'object') {          // reactive-condition tier
      let done = false, disp;
      disp = this.on(typeOrConds, (...args) => {
        if (done) return; done = true;
        try { return cb.apply(this, args); }
        finally { if (typeof disp === 'function') disp(); }
      });
      return disp;
    }
    const el = this, t = String(typeOrConds);
    if (t[0] !== '@' && !sel) return this.on(t, cb, { once: true });   // native once
    // lifecycle / delegated: done-flag wrapper (per-callback lifecycle off is a known
    // gap; the wrapper stays registered inert after firing — single-fire guaranteed)
    let done = false;
    const wrapper = function (...a) {
      if (done) return; done = true;
      const r = cb.apply(this, a);
      if (t[0] !== '@') el.off(t, wrapper);
      return r;
    };
    wrapper._original = cb;
    return sel ? this.on(t, sel, wrapper) : this.on(t, wrapper);
  }

  /* bind — 0.73's three-overload declarative binding layer on the unified write path:
   *   bind('click', '$count', fn)  → on event, r = fn($, this, e); r !== undefined → set(key, r)
   *   bind('$count', fn)           → sugar for the object form
   *   bind({ key: fn, … })         → one live shallow effect keeping keys in sync (rides ψ) */
  bind(first, second, third) {
    if (typeof first === 'string' && typeof second === 'string' && typeof third === 'function') {
      return this.on(first, (e) => {
        const r = third.call(this, this.$, this, e);
        if (r !== undefined) this.set(second, r);
      });
    }
    if (typeof first === 'string' && typeof second === 'function')
      return this.bind({ [first]: second });
    if (first !== null && typeof first === 'object') {
      const entries = Object.entries(first);
      this.ψ(() => {
        for (const [k, fn] of entries) {
          const r = fn.call(this, this.$, this);
          if (r !== undefined) this.set(k, r);
        }
      });
    }
    return this;
  }

  /* callbind — the frozen destructure-safe scoped API (0.73's crown jewel):
   * mutators return el (chain), readers return values. Parked pending the
   * kernel-verbs pass: notify/watch/computed/signal/readonly/resource/inherit/next. */
  callbind() {
    const el = this;
    const chain = (name) => (...a) => (el[name](...a), el);
    const pass  = (name) => (...a) => el[name](...a);
    return Object.freeze({
      el,
      $: el.$, $$: el.$$, '@': el['@'], ø: el.ø, ψ: el.ψ,
      set: chain('set'), add: chain('add'), emit: chain('emit'), trigger: chain('trigger'),
      on: chain('on'), off: chain('off'), once: chain('once'), bind: chain('bind'),
      find: pass('find'), findAll: pass('findAll'),
      peek: (k) => el.$(k),
      effect: (fn, key, opts) => (el.ψ(fn, key, opts), el),
      batch: (fn) => Signal.batch(fn),
      untrack: (fn) => Signal.untrack(fn),
      signal: (v) => el.signal(v),
      computed: (fn) => el.computed(fn),
      watch: (src, fn) => el.watch(src, fn),
      readonly: (sig) => el.readonly(sig),
      resource: (fn) => el.resource(fn),
      inherit: (k, src) => (el.inherit(k, src), el),
      clone: (deep) => el.clone(deep),
      remove: (t) => (el.remove(t), el),
      get: (k, o) => el.get(k, o),
      has: (t) => el.has(t),
      inspect: () => el.inspect(),
      subscribe: (cb) => el.subscribe(cb),
      unsubscribe: (cb) => (el.unsubscribe(cb), el),
      notify: (...a) => (el.notify(...a), el),
      post: (u, b, o) => (el.post(u, b, o), el),
    });
  }

  /* ── unified verbs (Pass G) — same API at every level, scoped to `this` ── */

  /* get — parser-routed: sigil → reactive read · URL-ish → HTTP GET (promise) ·
   * '.cls' → classList test · property · attribute. */
  get(key, opts) {
    if (key == null) return undefined;
    const k = String(key);
    if (_looksLikeURL(k)) return _httpGET(k, opts);
    if (/^[$Δ@ø]/.test(k)) return this[k];
    if (k[0] === '.') return this.classList.contains(k.slice(1));
    if (k in this) return this[k];
    return (this.hasAttribute && this.hasAttribute(k)) ? this.getAttribute(k) : undefined;
  }

  /* has — Node → contains · sigil → store · '.cls' · property/attribute. */
  has(target) {
    if (target instanceof Node) return this.contains(target);
    const k = String(target);
    if (/^[$Δ@ø]/.test(k)) { const ss = this[REACTIVE_STORE]; return !!(ss && ss.has(k)); }
    if (k[0] === '.') return this.classList.contains(k.slice(1));
    return (k in this) || (this.hasAttribute ? this.hasAttribute(k) : false);
  }

  /* remove — () → detach self · Node → removeChild · '@evt' → off (set/add symmetry) ·
   * sigil → store delete · '.cls' · attribute. */
  remove(target) {
    /* bare + boolean honor the LIFECYCLE contract (this method shadows the old
     * Lifecycle.remove(hard), which the splice order buried — Pass P unified
     * them): remove() = detach ('@removal' fires SYNCHRONOUSLY, element stays
     * alive), remove(true) = dispose (the only real teardown). Everything else
     * is the ported sigil dispatch. */
    if (target === undefined) return Lifecycle.detach(this);
    if (target === true) return Lifecycle.dispose(this);
    if (target instanceof Node) { if (target.parentNode === this) this.removeChild(target); return this; }
    const k = String(target);
    if (k[0] === '@' || (k[0] === ':' && k[1] === ':')) { this.off(k); return this; }
    if (/^[$Δø]/.test(k)) { const ss = this[REACTIVE_STORE]; if (ss && ss.delete) ss.delete(k); return this; }
    if (k[0] === '.') { this.classList.remove(k.slice(1)); return this; }
    this.removeAttribute(k); return this;
  }

  /* batch — (fn) kernel batch passthrough · ({obj}) one-flush routed writes via set(). */
  batch(a) {
    if (typeof a === 'function') return Signal.batch(a);
    if (a !== null && typeof a === 'object') { Signal.batch(() => { for (const k of Object.keys(a)) this.set(k, a[k]); }); return this; }
    return this;
  }
  untrack(fn) { return Signal.untrack(fn); }

  inspect() {
    const ss = this[REACTIVE_STORE]; const store = {};
    if (ss) for (const k of ss.dict.keys()) if (!String(k).endsWith('$$effect'))
      store[k] = Signal.untrack(() => this[k]);
    return { tag: this.localName, id: this.id || null, classes: [...this.classList],
      attributes: this.attributes ? this.attributes.length : 0, children: this.children.length, store };
  }

  /* post — STUB (0.87.h): routing per spec — HTTP POST unless { message: true }
   * (postMessage interop); both land with the network pass. */
  post(url, body, opts) {
    if (opts && opts.message) { console.warn('[Instance] post(): message-channel interop is stubbed — queued for the network pass'); return this; }
    console.warn('[Instance] post(): HTTP POST is stubbed — queued for the network pass');
    return this;
  }

  /* ── transitions (Pass L) ── */
  /* ── transitions surface — resolution + WAAPI/fallback machinery lives in §11 below ── */
  transition(nameOrConfig) {
    const el = this;
    const config = _trResolve(el, nameOrConfig);
    if (!config) return Promise.resolve(el);
    const target = config.el || el;
    const name = config._name || (typeof nameOrConfig === 'string' ? nameOrConfig : 'inline');
    const scope = config._scope || 'local';
    const fullKey = (scope === 'shadow' ? '::' : '') + name;
    let active = ACTIVE_TR.get(el);
    if (!active) ACTIVE_TR.set(el, active = new Set());
    if (active.has(fullKey)) return Promise.resolve(el);
    active.add(fullKey);
    _nsFire(el, '@transition', { name: fullKey, phase: 'start', duration: config.duration, scope });
    return _trRun(target, config).then(() => {
      active.delete(fullKey);
      _nsFire(el, '@transition', { name: fullKey, phase: 'end', duration: config.duration, scope });
      return el;
    });
  }
  /* '::transition' — shadow-channel receiver: { detail: { to } } → run it. */
  ['::transition'](context) {
    const to = context && context.detail && context.detail.to;
    return to ? this.transition(to) : Promise.resolve(this);
  }

  /* ── kernel verbs (Pass E) — the callbind parked list, on Signal.State/Computed ── */

  signal(v)      { return new Signal.State(v); }
  computed(fn)   { return new Signal.Computed(fn); }

  readonly(sig) {
    return Object.freeze({
      get: () => sig.get(), peek: () => sig.peek(),
      [Symbol.toPrimitive]() { return sig.get(); },
      toString() { const v = sig.get(); return v == null ? '' : String(v); }
    });
  }

  /* watch — 0.73 semantics: prime old value untracked; on change, fn(newValue, prev, $)
   * runs untracked; a plain-object return bulk-applies to the store (rides ψ). */
  watch(source, fn) {
    const $ = this.$;
    const getter = typeof source === 'function' ? () => source($) : () => source.get();
    let oldValue = Signal.untrack(getter);
    const node = new Signal.Effect(() => {
      const newValue = getter();
      if (newValue !== oldValue) {
        const prev = oldValue; oldValue = newValue;
        let result; Signal.untrack(() => { result = fn.call(this, newValue, prev, $); });
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) this.ψ(result);
      }
    });
    return () => { try { node.dispose && node.dispose(); } catch (e) {} };
  }

  /* resource — 0.73 semantics: tracked async effect; deps read inside asyncFn drive refetch. */
  resource(asyncFn) {
    const data = new Signal.State(undefined), loading = new Signal.State(false), error = new Signal.State(null);
    this.effect(async () => {
      loading.set(true); error.set(null);
      try { data.set(await asyncFn.call(this, this.$)); }
      catch (e) { error.set(e); }
      finally { loading.set(false); }
    });
    return Object.freeze({ data, loading, error });
  }

  /* inherit — share a cell between owners: the store dict holds node refs, so aliasing
   * a key to another owner's node makes reads AND writes flow through one shared cell. */
  inherit(key, source) {
    const k = /^[$Δ@ø]/.test(key) ? key : '$' + key;
    const m = k.match(/^([$Δ@ø]{1,3})(.*)$/); const sigil = m[1], bare = m[2];
    let node = null;
    if (source && typeof source.get === 'function' && typeof source.ptr === 'number') node = source;   // a Signal handle
    else if (source) {
      const tier = sigil === '@' ? source['@'] : sigil === 'ø' ? source.ø : sigil.length === 2 ? source.$$ : source.$;
      if (typeof tier === 'function') node = tier[bare];                                    // triad handle (mints on miss)
    }
    if (!node) throw new Error('[Instance] inherit() — unrecognised source');
    const store = STORE.get(this);
    if (store) { store.dict.set(k, node.ref); store._proxies && store._proxies.delete(k); }
    return this;
  }

  clone(deep = true) { return this.cloneNode(deep); }

  /* route — register this element as an outlet; resolves the current location
   * immediately unless { immediate: false }. */
  route(routeMap, options) {
    _ROUTER._register(this, routeMap, options);
    if (!options || options.immediate !== false) {
      const loc = _RT.config.history === 'hash'
        ? ((typeof location !== 'undefined' && location.hash && location.hash.slice(1)) || '/')
        : (typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/');
      Router.navigate(loc, true);
    }
    return this;
  }

  on(typeOrConds, selOrFn, fnArg, a3, a4) {
    // ── DOM-event HANDLE tier (Pass Q8b) — FIRST: handles are objects and must be
    //    claimed before the condition-object tier can swallow them. ──
    if (typeOrConds && (typeof typeOrConds === 'object' || typeof typeOrConds === 'function') && typeOrConds[EVT_HANDLE] && typeof selOrFn === 'function') {
      const d = _hSubscribe(typeOrConds[EVT_HANDLE], this, selOrFn);
      if (this.nodeType === 1) { let set = _EVT_SUBS.get(this); if (!set) _EVT_SUBS.set(this, set = new Set()); set.add(d); }
      return d;
    }
    if (typeOrConds !== null && typeof typeOrConds === 'object' && !(typeOrConds instanceof Node) && !typeOrConds[EVT_HANDLE]) {
      const cb = selOrFn; if (typeof cb !== 'function') return this;
      const conds = Object.entries(typeOrConds).map(([k, want]) => [k[0] === '$' || k[0] === '@' ? k : '$' + k, want]);
      return _instEffect(this, () => { let all = true; for (const [k, want] of conds) if (this[k] !== want) all = false; if (all) cb.call(this, this); });
    }
    const t0 = String(typeOrConds).trim();
    // ── meta tiers (Pass D): ':name' observes standard listener additions, ':::name' observes @/:: ones ──
    if (/^(:{3}|:)(?!:)/.test(t0) && !/^:{1,3}(addition|removal)$/.test(t0)) {
      const cb = typeof selOrFn === 'function' ? selOrFn : fnArg;
      if (typeof cb !== 'function') return this;
      const name = t0.replace(/^:+/, '');
      const depth = t0.length - name.length;                     // 1 (standard) | 3 (meta-shadow)
      if (depth === 1) this._wireStandardInterceptors();
      const nn = depth === 1 ? _normEvent(name) : name;
      return this.on(':'.repeat(depth) + 'addition', (e) => {
        const d = e.detail || {};
        if (depth === 3 ? (d.type === nn || d.type === '@' + nn || d.type === '::' + nn) : d.type === nn)
          cb.call(this, d.listener, nn, e);
      });
    }
    // ── DOM-event class tier (Pass Q8): on(MouseDown, fn) — one shared pump per
    //    (element, type) feeding a kernel pulse; disposer returned; drains at dispose. ──
    if (typeof typeOrConds === 'function' && typeof typeOrConds[EVT_TYPE] === 'string' && typeof selOrFn === 'function')
      return _evtSubscribe(this, typeOrConds[EVT_TYPE], selOrFn);
    // ── '@change' subscription tier (Pass Q2): on('@change', src, cb) — src is a class-static
    //    sigil name ('$mark', resolved on this.constructor so the accessor read is TRACKED) or a
    //    getter fn. Rides _instEffect: the first (arming) run is swallowed — '@change' means
    //    change — and the effect ref lives in the element's store, so dispose() drains it. ──
    if (t0 === '@change' && typeof fnArg === 'function'
      && (typeof selOrFn === 'function' || (typeof selOrFn === 'string' && (selOrFn[0] === '$' || selOrFn[0] === 'Δ')))) {
      const read = typeof selOrFn === 'function' ? selOrFn : () => this.constructor[selOrFn];
      let first = true;
      return _instEffect(this, () => { const v = read.call(this); if (first) { first = false; return; } fnArg.call(this, v, this); });
    }
    // ── lifecycle '@' and shadow '::' tiers: keyed fans via _lcAdd, identity-aware, meta-announced ──
    if (t0[0] === '@' || (t0[0] === ':' && t0[1] === ':' && t0[2] !== ':')) {
      const cb = typeof selOrFn === 'function' ? selOrFn : fnArg;
      if (typeof cb !== 'function') return this;
      let key = t0, id = null, scoped = false;
      const hh = key.indexOf('##');
      if (hh !== -1) { id = key.slice(hh + 2); key = key.slice(0, hh); scoped = true; }
      else { const h = key.indexOf('#'); if (h !== -1) { id = key.slice(h + 1); key = key.slice(0, h); } }
      if (id) this.off(scoped ? key + '##' + id : '#' + id);     // identity hot-swap (0.73 semantics)
      const dispose = _lcAdd(this, key, cb);
      _evStore(this).push({ type: key, wrapped: cb, id, scoped, dispose });
      this.emit(':::addition', { type: key, listener: cb });
      return dispose;
    }
    let type = t0, selector = null, cb, rest;
    if (typeof selOrFn === 'string') { selector = selOrFn; cb = fnArg; rest = [a3, a4]; }
    else { cb = selOrFn; rest = [fnArg, a3]; }
    if (typeof cb !== 'function') return this;
    // remaining slots disambiguate by type: an object is options, a function is afterFn (order-independent)
    let options = null, afterFn = null;
    for (const r of rest) {
      if (typeof r === 'function') { if (!afterFn) afterFn = r; }
      else if (r && typeof r === 'object') { if (!options) options = r; }
    }
    let id = null, scoped = false;
    const hh = type.indexOf('##');
    if (hh !== -1) { id = type.slice(hh + 2); type = type.slice(0, hh); scoped = true; }
    else { const h = type.indexOf('#'); if (h !== -1) { id = type.slice(h + 1); type = type.slice(0, h); } }
    type = _normEvent(type);
    if (id) this.off(scoped ? type + '##' + id : '#' + id);      // identity hot-swap (0.73 semantics)
    const self = this;
    const ctr = { n: 0 };
    const wrapped = afterFn
      ? (selector
          ? (e) => { const tgt = e.target && e.target.closest(selector); if (tgt && self.contains(tgt)) _withAfter(tgt, e, tgt, cb, afterFn, ctr); }
          : (e) => _withAfter(self, e, undefined, cb, afterFn, ctr))
      : (selector
          ? (e) => { const tgt = e.target && e.target.closest(selector); if (tgt && self.contains(tgt)) cb.call(tgt, e, tgt); }
          : (e) => cb.call(self, e));
    const nativeOpts = {};
    if (options && typeof options === 'object') for (const f of ['capture', 'once', 'passive', 'signal']) if (f in options) nativeOpts[f] = options[f];
    _inOn = true;
    this.addEventListener(type, wrapped, nativeOpts);
    _inOn = false;
    _evStore(this).push({ type, wrapped, id, scoped, selector });
    this.emit(':addition', { type, listener: wrapped });
    return this;
  }

  off(target, cbArg) {
    const store = _EV.get(this);
    if (typeof target === 'string' && (target[0] === '@' || (target[0] === ':' && target[1] === ':' && target[2] !== ':'))) {
      const m = LC_LISTENERS.get(this); const setr = m && m.get(target);
      if (setr) {
        if (typeof cbArg === 'function') {
          for (const f of setr) if (f === cbArg || f._original === cbArg) { setr.delete(f); this.emit(':::removal', { type: target, listener: f }); break; }
        } else { setr.clear(); this.emit(':::removal', { type: target, listener: null }); }
      }
      if (store) for (let i = store.length; i--; ) if (store[i].type === target && (!cbArg || store[i].wrapped === cbArg || store[i].wrapped._original === cbArg)) store.splice(i, 1);
      return this;
    }
    if (!store) return this;
    if (typeof target === 'string' && target.includes('##')) {
      const j = target.indexOf('##'); const t = target.slice(0, j), id = target.slice(j + 2);
      for (let i = store.length; i--; ) { const e = store[i]; if (e.scoped && e.id === id && e.type === t) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
      return this;
    }
    if (typeof target === 'string' && target[0] === '#') {
      const id = target.slice(1);
      for (let i = store.length; i--; ) { const e = store[i]; if (e.id === id && !e.scoped) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
      return this;
    }
    const type = target ? _normEvent(target) : null;
    for (let i = store.length; i--; ) { const e = store[i]; if (!type || e.type === type) { e.dispose ? e.dispose() : this.removeEventListener(e.type, e.wrapped); store.splice(i, 1); } }
    return this;
  }
}
void new Events({ target: Instance, 'proto=>proto': true }); // one declaration — the splice IS the install


function _seq(el, work) { const prev = AWAITING.get(el) ?? Promise.resolve(); bindThenable(el, prev.then(() => work).catch(() => {})); return Instance.makeChainable(work.then(() => el)); }

/* ═══ §9 CHAIN — the writethrough / template-tag surface ═══
 * set(…) in all its overloads (key/value · object · template-tag), the
 * reactive tagged-template path (_tag: object interpolations mint $keys and
 * ride one effect), and the chainable await face. Same install pattern as
 * Events; state rides the §3-minted stores. */
class Chain extends Interface {

  _isTag(args) { return Array.isArray(args[0]) && args[0].raw !== undefined; }
  _tag(strings, values, callback) {
    const reactive = values.some(v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node));
    if (!reactive) { callback(strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')); return this; }
    this.effect(() => {
      const out = strings.reduce((acc, s, i) => {
        const v = values[i];
        if (v == null) return acc + s;
        if (v && typeof v.get === 'function') return acc + s + String(v);
        if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node)) {
          const parts = Object.entries(v).map(([key, def]) => { const sk = key[0] === '$' ? key : '$' + key; if (!(this[REACTIVE_STORE] && this[REACTIVE_STORE].has(sk))) this[sk] = def; return String(this[sk]); });
          return acc + s + parts.join('');
        }
        return acc + s + String(v);
      }, '');
      callback(out);
    });
    return this;
  }
  set(...args) {
    if (this._isTag(args)) { const [strings, ...values] = args; return this._tag(strings, values, v => { this.textContent = v; }); }
    const [key, value] = args;
    if (key && typeof key === 'object') { for (const [k, v] of Object.entries(key)) this.set(k, v); return this; }
    const k = String(key);
    if (args.length === 1 && k[0] !== '.' && k[0] !== '$' && k[0] !== '@') { this.textContent = k; return this; }
    if (k[0] === '.') { this.classList.toggle(k.slice(1), value === undefined ? true : !!value); return this; }
    if (k[0] === '$') { this[k] = value; return this; }
    if (k[0] === 'ø' || k[0] === 'Δ') { this[k] = value; return this; }
    if (k[0] === '@') { this.on(k, value); return this; }
    if (k in this) { this[k] = value; return this; }
    this.setAttribute(k, value === true ? '' : String(value ?? ''));
    return this;
  }
  add(...args) {
    if (this._isTag(args)) { const [strings, ...values] = args; const t = doc.createTextNode(''); this.appendChild(t); return this._tag(strings, values, v => { t.data = v; }); }
    const [thing, fn] = args;
    if (thing instanceof Node) { this.appendChild(thing); return this; }
    if (typeof thing === 'function') { const r = thing(); if (r instanceof Node) this.appendChild(r); return this; }
    if (typeof thing === 'string') {
      const t = thing.trim();
      if (typeof fn === 'function' && t[0] === '@') { this.on(t, fn); return this; }
      if (t[0] === '.') { this.classList.add(t.slice(1)); return this; }
      this.appendChild(doc.createTextNode(thing)); return this;
    }
    return this;
  }
  find(selector)    { return new Collection(this.querySelectorAll(String(selector))); }
  findAll(selector) { return this.find(selector); }
  sleep(ms, callback) {
    const el = this;
    const work = new Promise(resolve => setTimeout(async () => { try { if (callback) await callback(el); } finally { resolve(); } }, ms));
    return _seq(el, work);
  }
  init(...behaviors) {
    const el = this;
    const runOne = (b) => { if (typeof b === 'function') return b.call(el, el); if (b && typeof b === 'object') for (const [event, handler] of Object.entries(b)) el.on(event, handler); };
    for (let i = 0; i < behaviors.length; i++) {
      const r = runOne(behaviors[i]);
      if (r && typeof r.then === 'function') {
        const work = (async () => { await r; for (let j = i + 1; j < behaviors.length; j++) { const n = runOne(behaviors[j]); if (n && typeof n.then === 'function') await n; } })();
        return _seq(el, work);
      }
    }
    return this;
  }
  async(...behaviors) {
    const el = this;
    const ps = behaviors.map(b => { if (typeof b === 'function') { const r = b.call(el, el); return r && typeof r.then === 'function' ? r : Promise.resolve(r); } return (b && typeof b.then === 'function') ? b : Promise.resolve(b); });
    const work = Promise.all(ps).then(() => {});
    return _seq(el, work);
  }
}
void new Chain({ target: Instance, 'proto=>proto': true });



defineProperty(Instance, 'makeChainable', {
  value(promise) {
    return new Proxy(promise, {
      get(target, prop) {
        if (prop in target) { const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }
        return (...args) => Instance.makeChainable(target.then(r => {
          if (typeof r[prop] !== 'function') throw new TypeError("Method '" + String(prop) + "' does not exist on the resolved element.");
          return r[prop](...args);
        }));
      }
    });
  }, configurable: true
});
defineProperty(Instance, 'from', { value(items) { return new Collection(items); }, configurable: true });
defineProperty(Instance, 'Collection', { value: Collection, configurable: true });

if (doc) {
  const $sel  = (sel) => typeof sel === 'string' ? doc.querySelector(sel) : sel;
  const $$sel = (sel) => new Collection(typeof sel === 'string' ? doc.querySelectorAll(sel) : sel);
  if (!('$' in global))  defineProperty(global, '$',  { value: $sel,  configurable: true, writable: true });
  if (!('$$' in global)) defineProperty(global, '$$', { value: $$sel, configurable: true, writable: true });
}


	new Instance(global); // §6 #initialize: generate the configured shape synchronously at load (Div/Span/…)
	if (doc) Lifecycle.start(); // begin observing once the core elements exist


	function isInstanceScript(script) {
		const type = (script.getAttribute('type') || '').toLowerCase();
		return INSTANCE_TYPES.has(type) || /\.is(\?|$)/.test(script.getAttribute('src') || '');
	}

	async function fetchText(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error('fetch ' + url + ' → ' + response.status);
		return response.text();
	}

		// scan the page for <script type=text/instance>, compile + run each
	async function bootstrap() {
		if (!doc) return;
		for (const script of [...doc.scripts].filter(isInstanceScript)) await bootScript(script);
	}

	bootScript.once = false;
	async function bootScript(script) {
		if (bootScript.once) return; bootScript.once = true;
		// element generation is centralized in §6 #initialize (once, at load); scripts only compile + run
		try {

			const source = (async (s) => {
				if (s === 'data:text/javascript,' || !s) return script.textContent;
				return await fetchText(s);
			})(script.src)

			if (source && source.trim()) run(source);
		} catch (error) {
			(console.error || console.log)('[Instance] script failed:', (error && error.message) || error);
		}
	}
	if (doc) {
		if (doc.readyState === 'loading') {
			doc.addEventListener('DOMContentLoaded', bootstrap, { once: true });
		}
		else bootstrap();
	}

	/* ════════════════════════════════════════════════════════════════════════
	* §11 — public surface
	* ════════════════════════════════════════════════════════════════════════ */
	defineProperties(Instance, {
		version: { value: '0.87.z', enumerable: true },
		elements: { value: REGISTRY, enumerable: false },
		Compiler: { get() { return COMPILER; } },
		Chimera: { get() { return CHIMERA } },
		layer: { value: layer },
		Interface: { value: Interface },
		Lifecycle: { value: Lifecycle },
		DSL: { value: DSL },
		JSDOM: { value: JSDOM },
		Lexeme: { value: Lexeme },
		PENDING: { value: PENDING, enumerable: true },
		POISONED: { value: POISONED, enumerable: true },
		compile: { value: compile },
		run: { value: run },
		UUID: {
			value: key => {
				if (typeof key !== 'string' || !key) throw new Error('Instance.UUID expects a non-empty key');
				return Symbol.for(key);
			}
		}
	});
	return Instance;
},
{
	/* EXTMAP */

	['ROUTER']: null, // client-side routing
	['STORE']: null, // global state store
	['I18N']: null, // internationalization
	['DEVTOOLS']: null, // developer tools overlay
	['COMPILER']: COMPILER_FACTORY,

	['CHIMERA']: CHIMERA_API,
	['DSL']: DSL_PLUGIN,


}));

// The loader is async (for-await over EXTMAP) → the module resolves to a Promise.
// Node: const Instance = await require('./Instance-0_86_d.js');
// if (typeof module === 'object' && typeof module.exports === 'object') module.exports = __instanceBoot;

/* __INSTANCE_READY__ is a Promise<Instance>; core also sets globalThis.Instance on resolve.
   Expose a readiness promise that ALSO boots the element-class globals, for classic consumers. */
globalThis.InstanceReady = __INSTANCE_READY__.then(function (Instance) {
	if (typeof document !== 'undefined') { try { new Instance(globalThis); } catch (e) { console.error('[Instance bundle] boot failed:', e); } }
	return Instance;
});
})();