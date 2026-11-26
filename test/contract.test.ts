import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Defaults, findCommand, readContracts, type InstalledExtension } from "../src/contract";

const ext = (id: string, packageJSON: InstalledExtension["packageJSON"]): InstalledExtension => ({ id, packageJSON });

describe("contracts", () => {
  it("uses EDGEguide's default for an EDGE extension without its own key, keeping what it contributes", () => {
    const [c] = readContracts([
      ext("edgemodders.edgedeck", {
        version: "1.0.0",
        contributes: { views: { edgedeck: [{ id: "edgedeck.mods" }] }, commands: [{ command: "edgedeck.deploy" }] },
      }),
    ]);
    assert.equal(c.source, "EDGEguide's default");
    assert.deepEqual(c.views, ["edgedeck.mods"]);
    assert.deepEqual(Object.keys(c.commands), ["edgedeck.deploy"]);
    assert.equal(c.commands["edgedeck.deploy"].changes, true);
    assert.ok(c.dropped.some((d) => d.startsWith("command edgedeck.openPage")));
  });

  it("an extension's own key replaces the default, and cannot list commands it does not contribute", () => {
    const [c] = readContracts([
      ext("edgemodders.edgedeck", {
        edgeguide: {
          views: ["edgedeck.mods", "workbench.view.explorer"],
          reveal: "edgedeck.edgeguide.reveal",
          commands: { "edgedeck.openPage": { changes: false }, "edgedeck.deploy": { hint: "x" }, "workbench.action.terminal.sendSequence": { changes: false } },
        },
        contributes: { views: { edgedeck: [{ id: "edgedeck.mods" }] }, commands: [{ command: "edgedeck.deploy" }, { command: "edgedeck.openPage" }] },
      }),
    ]);
    assert.equal(c.source, "own");
    assert.deepEqual(c.views, ["edgedeck.mods"]);
    assert.deepEqual(c.commands, { "edgedeck.openPage": { changes: false }, "edgedeck.deploy": { changes: true, hint: "x" } });
    assert.equal(c.reveal, undefined, "a reveal command it does not contribute is dropped");
    assert.equal(c.dropped.length, 3);
  });

  it("an extension EDGEguide has no default for and no key is left out", () => {
    assert.deepEqual(readContracts([ext("someone.else", { contributes: { commands: [{ command: "x" }] } })]), []);
  });

  it("findCommand finds the owner", () => {
    const cs = readContracts([ext("edgemodders.edgedeck", { contributes: { commands: [{ command: "edgedeck.undo" }] } })]);
    assert.equal(findCommand(cs, "edgedeck.undo")?.contract.extension, "edgemodders.edgedeck");
    assert.equal(findCommand(cs, "edgedeck.deploy"), undefined);
  });

  it("every default command has a hint", () => {
    for (const c of Object.values(Defaults)) for (const [id, r] of Object.entries(c.commands)) assert.ok(r.hint, id);
  });
});
