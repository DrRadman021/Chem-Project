// Unit tests for the RACHEM covalent structure-identification engine.
// Extracts the exact code blocks from index.html (no duplication) and exercises them in Node.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extract(startMark, endMark) {
  const i = html.indexOf(startMark);
  assert.ok(i >= 0, "missing block: " + startMark);
  const j = html.indexOf(endMark, i);
  assert.ok(j >= 0, "missing end: " + endMark);
  return html.slice(i, j + endMark.length);
}
function extractLine(prefix) {
  const i = html.indexOf(prefix);
  assert.ok(i >= 0, "missing line: " + prefix);
  const j = html.indexOf("\n", i);
  return html.slice(i, j);
}

const structid = extract("/*STRUCTID-START", "/*STRUCTID-END*/");
const parseFn = extract("function parse(f){", "متوازن نیستند.\"));return r}");
const hillFn = extractLine("const HILL=");
const molsFn = extractLine("const MOLS=[");
const msBlock = extract("const MS=`", "`;");
const msLoop = extract('MS.split("\\n").forEach', "MOLS.push([f,en,fa,c,lg.split(\",\").flatMap(t=>{const[a,n]=t.split(\"*\");return Array(+(n||1)).fill(a)}),+o,+lp])});");

const src = `
const X=(a,b)=>a;
const MASS=new Proxy({},{has:()=>true});
let S={at:[],bd:[]};
const fc=a=>a.q||0;
${parseFn}
${hillFn}
${molsFn}
const have=new Set(MOLS.map(m=>HILL(parse(m[0]))));
${msBlock}
${msLoop}
${structid}
return {smiParse,ckey,SR,ensureSDB,structMatch,candOf,getSDB:()=>SDB,getBYF:()=>BYF,MOLS,setS(v){S=v},fc,HILL,parse};
`;
const M = new Function(src)();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); }
}

// helper: build builder-state S from a parsed SMILES graph (charges included)
function loadGraph(smi) {
  const g = M.smiParse(smi);
  M.setS({
    at: g.at.map((a, i) => ({ id: i + 1, s: a.s, q: a.q })),
    bd: g.bd.map((b, i) => ({ id: i + 1, a: b[0] + 1, b: b[1] + 1, o: b[2] }))
  });
}
function identify(smi) { const r = M.structMatch(); return r ? r.en : null; }
function idOf(smi) { loadGraph(smi); return identify(smi); }
function hillOf(smi) {
  const g = M.smiParse(smi); const c = {};
  g.at.forEach(a => c[a.s] = (c[a.s] || 0) + 1);
  return M.HILL(c);
}

console.log("\n== SMILES parser ==");
t("parses ethanol with correct atoms/bonds", () => {
  const g = M.smiParse("CCO");
  assert.equal(g.at.length, 9); // C2H6O
  assert.equal(g.bd.length, 8);
});
t("implicit H respects bond orders (propene C3H6)", () => {
  const c = {}; M.smiParse("CC=C").at.forEach(a => c[a.s] = (c[a.s] || 0) + 1);
  assert.equal(c.H, 6); assert.equal(c.C, 3);
});
t("ring closure orders (benzene Kekulé)", () => {
  const g = M.smiParse("C1=CC=CC=C1");
  assert.equal(g.at.length, 12);
  const ringBonds = g.bd.filter(b => b[0] < 6 && b[1] < 6);
  assert.equal(ringBonds.length, 6);
  assert.equal(ringBonds.filter(b => b[2] === 2).length, 3);
});
t("bracket atoms: charges and explicit H", () => {
  const g = M.smiParse("[NH4+]");
  assert.equal(g.at.length, 5); assert.equal(g.at[0].q, 1);
  assert.equal(g.at.slice(1).every(a => a.s === "H" && a.q === 0), true);
});
t("hypervalent S does not gain implicit H (sulfate)", () => {
  const c = {}; M.smiParse("[S](=O)(=O)([O-])[O-]").at.forEach(a => c[a.s] = (c[a.s] || 0) + 1);
  assert.equal(c.H, undefined); assert.equal(c.O, 4);
});
t("invalid SMILES throw", () => {
  for (const bad of ["C((C", "C1CC", "Xx", "[C", "C)C", "1C"]) {
    assert.throws(() => M.smiParse(bad), "should throw: " + bad);
  }
});

console.log("\n== SDB construction ==");
t("SDB builds without skipped entries", () => {
  M.ensureSDB();
  const sdb = M.getSDB();
  assert.ok(sdb.size >= M.SR.length, "SDB should have at least SR count entries");
});
t("no two different names share a canonical key", () => {
  M.ensureSDB();
  for (const [, r] of M.getSDB()) for (const [, r2] of M.getSDB()) {
    if (r !== r2 && r.en !== r2.en) {
      assert.notEqual(M.ckey(r.at, r.bd, true), M.ckey(r2.at, r2.bd, true),
        "key collision: " + r.en + " vs " + r2.en);
    }
  }
});
t("MOLS star molecules auto-generate structural records", () => {
  assert.equal(idOf("O"), "Water");
  assert.equal(idOf("C"), "Methane");
  loadGraph("O=C=O"); assert.equal(identify(), "Carbon dioxide");
  loadGraph("N#N"); assert.equal(identify(), "Nitrogen");
  loadGraph("O=O"); assert.equal(identify(), "Oxygen");
  loadGraph("F"), assert.equal(identify(), "Hydrogen fluoride");
  loadGraph("F[S](F)(F)(F)(F)F"); assert.equal(identify(), "Sulfur hexafluoride");
  loadGraph("[C-]#[O+]"); assert.equal(identify(), "Carbon monoxide");
});

console.log("\n== required identification cases ==");
const cases = [
  ["O", "Water"], ["C", "Methane"], ["N", "Ammonia"], ["O=C=O", "Carbon dioxide"],
  ["O=O", "Oxygen"], ["N#N", "Nitrogen"], ["[C-]#[O+]", "Carbon monoxide"],
  ["CC", "Ethane"], ["C=C", "Ethene"], ["C#C", "Ethyne"],
  ["CCO", "Ethanol"], ["COC", "Dimethyl ether"],
  ["CCCO", "Propan-1-ol"], ["CC(C)O", "Propan-2-ol"], ["CCOC", "Methoxyethane"],
  ["C1=CC=CC=C1", "Benzene"], ["C1C=CC=CC=1", "Benzene"], // both Kekulé forms
  ["CC(=O)O", "Ethanoic acid (acetic acid)"], ["CC=O", "Ethanal (acetaldehyde)"],
  ["C#N", "Hydrogen cyanide"], ["[NH]#[C]", "Hydrogen isocyanide"],
  ["O=C=C", null], // cumulene C2? sanity: CO2 written differently still CO2
];
for (const [smi, exp] of cases) {
  if (exp === null) continue;
  t(smi + " → " + exp, () => assert.equal(idOf(smi), exp));
}
t("ethanol ≠ dimethyl ether (same formula C2H6O)", () => {
  assert.equal(hillOf("CCO"), hillOf("COC"));
  assert.notEqual(idOf("CCO"), idOf("COC"));
});
t("HCN ≠ HNC (same formula CHN)", () => {
  assert.equal(hillOf("C#N"), hillOf("[NH]#[C]"));
  assert.notEqual(idOf("C#N"), idOf("[NH]#[C]"));
});
t("double/triple bond order changes identity (ethane/ethene/ethyne)", () => {
  const n = new Set(["CC", "C=C", "C#C"].map(s => idOf(s)));
  assert.equal(n.size, 3);
});

console.log("\n== charged species ==");
t("[NH4+] → Ammonium ion (per-atom charge match)", () => assert.equal(idOf("[NH4+]"), "Ammonium ion"));
t("[OH-] → Hydroxide ion", () => assert.equal(idOf("[OH-]"), "Hydroxide ion"));
t("[OH3+] → Hydronium ion", () => assert.equal(idOf("[OH3+]"), "Hydronium ion"));
t("[C-]#N → Cyanide ion", () => assert.equal(idOf("[C-]#N"), "Cyanide ion"));
t("[N+]([O-])([O-])=O → Nitrate ion", () => assert.equal(idOf("[N+]([O-])([O-])=O"), "Nitrate ion"));
t("[C]([O-])([O-])=O → Carbonate ion", () => assert.equal(idOf("[C]([O-])([O-])=O"), "Carbonate ion"));
t("[S](=O)(=O)([O-])[O-] → Sulfate ion", () => assert.equal(idOf("[S](=O)(=O)([O-])[O-]"), "Sulfate ion"));
t("CC(=O)[O-] → Acetate ion", () => assert.equal(idOf("CC(=O)[O-]"), "Acetate ion"));
t("neutral NH3 does not match ammonium", () => assert.equal(idOf("N"), "Ammonia"));
t("ozone via neutral second pass (user draws O=O-O, f=0)", () => {
  loadGraph("[O-][O+]=O"); // record form matches directly
  assert.equal(identify(), "Ozone");
  // user-style drawing: same connectivity/orders, all formal charges zero
  M.setS({ at: [{ id: 1, s: "O", q: 0 }, { id: 2, s: "O", q: 0 }, { id: 3, s: "O", q: 0 }],
           bd: [{ id: 1, a: 1, b: 2, o: 2 }, { id: 2, a: 2, b: 3, o: 1 }] });
  assert.equal(identify(), "Ozone");
});
t("N2O both Lewis forms → Dinitrogen monoxide", () => {
  assert.equal(idOf("N#N[O]"), "Dinitrogen monoxide");
  assert.equal(idOf("[N-]=[N+]=O"), "Dinitrogen monoxide");
});

console.log("\n== canonical key invariance (isomorphism under shuffles) ==");
t("all SR entries: key stable under 25 random relabelings", () => {
  M.ensureSDB();
  let seed = 42;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (const [smi] of M.SR) {
    const g = M.smiParse(smi);
    const base = M.ckey(g.at, g.bd, true);
    for (let k = 0; k < 25; k++) {
      const n = g.at.length, perm = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = rnd(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const at2 = perm.map(i => g.at[i]);
      const bd2 = g.bd.map(b => [perm.indexOf(b[0]), perm.indexOf(b[1]), b[2]]);
      // shuffle bond list order too
      for (let i = bd2.length - 1; i > 0; i--) { const j = rnd(i + 1); [bd2[i], bd2[j]] = [bd2[j], bd2[i]]; }
      assert.equal(M.ckey(at2, bd2, true), base, "unstable key for " + smi);
    }
  }
});

console.log("\n== ambiguity / candidate listing ==");
t("C2H6O lists ethanol + dimethyl ether", () => {
  const c = M.candOf("C2H6O").map(r => r.en).sort();
  assert.deepEqual(c, ["Dimethyl ether", "Ethanol"]);
});
t("C3H8O lists 3 isomers", () => {
  assert.equal(M.candOf("C3H8O").length, 3);
});
t("C4H10 lists butane + isobutane", () => {
  assert.equal(M.candOf("C4H10").length, 2);
});
t("C2H4O lists ethanal + oxirane", () => {
  assert.equal(M.candOf("C2H4O").length, 2);
});
t("C3H6O lists ≥4 isomers", () => {
  assert.ok(M.candOf("C3H6O").length >= 4);
});
t("unknown isomer of C6H14 → no match, candidate list has hexane", () => {
  assert.equal(idOf("CC(C)CCC"), null); // 2-methylpentane, not in library
  assert.deepEqual(M.candOf("C6H14").map(r => r.en), ["Hexane"]);
});
t("structure not in library at all → no match, no candidates", () => {
  assert.equal(idOf("CS"), null);
  assert.equal(M.candOf("CS"), null); // carbon monosulfide: genuinely absent
});

console.log("\n== robustness ==");
t("bond referencing missing atom → null, no crash", () => {
  M.setS({ at: [{ id: 1, s: "O", q: 0 }], bd: [{ id: 1, a: 1, b: 99, o: 1 }] });
  assert.equal(identify(), null);
});
t("self bond → null", () => {
  M.setS({ at: [{ id: 1, s: "O", q: 0 }], bd: [{ id: 1, a: 1, b: 1, o: 1 }] });
  assert.equal(identify(), null);
});
t("disconnected fragments do not match a connected record", () => {
  // H2O + stray H  (4 atoms, water key has 3)
  M.setS({
    at: [{ id: 1, s: "O", q: 0 }, { id: 2, s: "H", q: 0 }, { id: 3, s: "H", q: 0 }, { id: 4, s: "H", q: 0 }],
    bd: [{ id: 1, a: 1, b: 2, o: 1 }, { id: 2, a: 1, b: 3, o: 1 }]
  });
  assert.equal(identify(), null);
});
t("empty structure → null", () => {
  M.setS({ at: [], bd: [] });
  assert.equal(identify(), null);
});

console.log("\n== formula sanity (Hill) ==");
t("Hill formulas of library entries", () => {
  assert.equal(hillOf("CCO"), "C2H6O");
  assert.equal(hillOf("CC(=O)O"), "C2H4O2");
  assert.equal(hillOf("C1=CC=CC=C1"), "C6H6");
  assert.equal(hillOf("[NH4+]"), "H4N");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
